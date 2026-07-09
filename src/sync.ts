import { createContext, useContext } from "react";
import type { AnalysisDoc, AppState, Stream } from "./types";
import type { ReinforcementState } from "./reinforcement";

// Cross-device sync via the viz-relay on Devin's own hosting (v2 backplane).
// The relay owns the JSON documents on its disk — GitHub (and its small
// shared gist-write budget, and the expiring PAT) is out of the loop
// entirely; the legacy gist is a frozen archive.
//
// Concurrency: every document carries a REVISION. Pulls capture it; pushes
// send it back as X-Viz-Rev-Base. If another device wrote in between, the
// relay answers 409 ("stale") instead of letting the newer copy be silently
// overwritten — the caller then re-pulls, merges (streams/reinforcement have
// real mergers; the board adopts the newer copy WITH a visible notice), and
// retries. That turns yesterday's silent multi-machine clobber into either a
// clean merge or a one-edit loss that announces itself.

export const DEFAULT_RELAY_URL = "https://www.devinkearns.com/viz/viz-relay.php";

export interface SyncConfig {
  url: string;
  key: string;
}

export interface SyncStatus {
  phase: "idle" | "syncing" | "ok" | "error";
  at?: number;
  message?: string;
}

/** Per-document revisions, as last seen from the relay. */
export interface DocRevs {
  board: number;
  streams: number;
  reinforcement: number;
}

const SYNC_CFG_KEY = "viz-org-sync-v3";
/** The pre-relay config key (gist PAT era) — read only to detect “needs reconnect”. */
const LEGACY_SYNC_CFG_KEY = "viz-org-sync-v2";

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && typeof c.url === "string" && typeof c.key === "string") return c;
  } catch {
    /* ignore */
  }
  return null;
}

/** True when this device synced under the old gist backplane and needs the
 * one-time relay-key reconnect. */
export function hasLegacyGistConfig(): boolean {
  try {
    return !!localStorage.getItem(LEGACY_SYNC_CFG_KEY) && !localStorage.getItem(SYNC_CFG_KEY);
  } catch {
    return false;
  }
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(SYNC_CFG_KEY);
  } catch {
    /* ignore */
  }
}

// --- typed failures -----------------------------------------------------------

/** The relay rejected the key — reconnect with the right one. */
export class RelayAuthError extends Error {
  constructor() {
    super("The relay didn't accept that key. Check it in Backup / Sync.");
    this.name = "RelayAuthError";
  }
}

/** Writes are temporarily throttled (relay burst limit or host trouble).
 * Callers must NOT hot-retry; pause until `resetAt`. */
export class SyncBusyError extends Error {
  readonly resetAt: number;
  constructor(resetAt?: number) {
    const at = resetAt ?? Date.now() + 45_000;
    super(`The sync service is busy — writes pause until ${new Date(at).toLocaleTimeString()}.`);
    this.name = "SyncBusyError";
    this.resetAt = at;
  }
}

/** Another device wrote this document since we pulled it (CAS miss). */
export class StaleWriteError extends Error {
  readonly doc: keyof DocRevs;
  readonly rev: number;
  constructor(doc: keyof DocRevs, rev: number) {
    super(`${doc} changed on another device (now rev ${rev})`);
    this.name = "StaleWriteError";
    this.doc = doc;
    this.rev = rev;
  }
}

// --- the relay client -----------------------------------------------------------

interface RelayResponse {
  text: string;
  rev: number;
  json: () => unknown;
}

async function relay(
  cfg: SyncConfig,
  action: string,
  init?: { method?: "GET" | "POST"; body?: string; baseRev?: number },
): Promise<RelayResponse> {
  const res = await fetch(`${cfg.url}?action=${encodeURIComponent(action)}`, {
    method: init?.method ?? "GET",
    // Belt to the relay's no-store braces: a cached GET here feeds the app a
    // stale board and a stale revision, which turns every push into a 409.
    cache: "no-store",
    headers: {
      "X-Viz-Key": cfg.key,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init?.baseRev !== undefined ? { "X-Viz-Rev-Base": String(init.baseRev) } : {}),
    },
    body: init?.body,
  });
  if (res.status === 401) throw new RelayAuthError();
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After")) || 45;
    throw new SyncBusyError(Date.now() + retry * 1000);
  }
  const text = await res.text();
  if (res.status === 409) {
    let rev = Number(res.headers.get("X-Viz-Rev")) || 0;
    try {
      const j = JSON.parse(text);
      if (typeof j?.rev === "number") rev = j.rev;
    } catch {
      /* header value stands */
    }
    throw new StaleWriteError(action as keyof DocRevs, rev);
  }
  if (!res.ok) throw new Error(`Sync failed (relay returned ${res.status})`);
  const rev = Number(res.headers.get("X-Viz-Rev")) || 0;
  return {
    text,
    rev,
    json: () => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

/** Connection test for the Sync dialog — throws RelayAuthError on a bad key. */
export async function testRelay(url: string, key: string): Promise<void> {
  const r = await relay({ url, key }, "ping");
  const j = r.json() as { ok?: boolean } | null;
  if (!j?.ok) throw new Error("That URL doesn't answer like a viz relay.");
}

/** Cheap revision overview — one GET tells a waking device what moved. */
export async function pullRevs(cfg: SyncConfig): Promise<Record<string, number> | null> {
  const r = await relay(cfg, "ping");
  const j = r.json() as { ok?: boolean; revs?: Record<string, number> } | null;
  return j?.ok && j.revs ? j.revs : null;
}

// --- serializers (same envelopes as the gist era, so nothing downstream moves) --

function serializeBoard(state: AppState): string {
  return JSON.stringify({ v: 1, state, savedAt: new Date().toISOString() }, null, 2);
}

function serializeStreams(streams: Stream[]): string {
  return JSON.stringify({ v: 3, streams, savedAt: new Date().toISOString() }, null, 2);
}

function serializeReinforcement(rs: ReinforcementState): string {
  return JSON.stringify(rs, null, 2);
}

// --- pulls (each returns the revision alongside the data) ------------------------

export async function pullBoard(cfg: SyncConfig): Promise<{ state: AppState | null; rev: number }> {
  const r = await relay(cfg, "board");
  const parsed = r.json() as { state?: AppState | null } | AppState | null;
  if (parsed && typeof parsed === "object" && "state" in parsed) {
    return { state: (parsed.state as AppState | null) ?? null, rev: r.rev };
  }
  if (parsed && Array.isArray((parsed as AppState).projects)) return { state: parsed as AppState, rev: r.rev };
  return { state: null, rev: r.rev };
}

export async function pullStreams(cfg: SyncConfig): Promise<{ streams: Stream[]; rev: number }> {
  const r = await relay(cfg, "streams");
  const parsed = r.json() as { streams?: Stream[] } | Stream[] | null;
  if (parsed && Array.isArray(parsed)) return { streams: parsed, rev: r.rev };
  if (parsed && Array.isArray(parsed.streams)) return { streams: parsed.streams, rev: r.rev };
  return { streams: [], rev: r.rev };
}

export async function pullReinforcement(
  cfg: SyncConfig,
): Promise<{ rs: ReinforcementState | null; rev: number }> {
  const r = await relay(cfg, "reinforcement");
  const parsed = r.json() as ReinforcementState | null;
  if (parsed && parsed.v === 1 && Array.isArray(parsed.events)) return { rs: parsed, rev: r.rev };
  return { rs: null, rev: r.rev };
}

export async function pullAnalysis(cfg: SyncConfig): Promise<AnalysisDoc | null> {
  const r = await relay(cfg, "analysis");
  const parsed = r.json();
  return parsed && typeof parsed === "object" ? (parsed as AnalysisDoc) : null;
}

/** Raw contents of the inbox drop box (null if empty), plus its revision. */
export async function pullInbox(cfg: SyncConfig): Promise<{ raw: string | null; rev: number }> {
  const r = await relay(cfg, "inbox");
  const trimmed = r.text.trim();
  return { raw: trimmed && trimmed !== "[]" ? trimmed : null, rev: r.rev };
}

/**
 * Empty the drop box after ingesting — CAS-guarded so candidates that landed
 * between the pull and the clear are never erased (a stale clear is skipped;
 * the next drain picks the newcomers up).
 */
export async function clearInbox(cfg: SyncConfig, baseRev: number): Promise<void> {
  try {
    await relay(cfg, "inbox", { method: "POST", body: "[]", baseRev });
  } catch (e) {
    if (e instanceof StaleWriteError) return; // new candidates arrived — leave them
    throw e;
  }
}

// --- pushes ------------------------------------------------------------------------

export interface DirtyDocs {
  board?: AppState;
  streams?: Stream[];
  reinforcement?: ReinforcementState;
}

/**
 * Push the dirty documents, each guarded by its last-seen revision. Documents
 * push sequentially; the first stale one throws StaleWriteError and the
 * caller resolves the conflict (merge or adopt) and reflushes. Returns the
 * updated revisions for everything that landed.
 */
export async function pushDocs(cfg: SyncConfig, dirty: DirtyDocs, revs: DocRevs): Promise<Partial<DocRevs>> {
  const out: Partial<DocRevs> = {};
  if (dirty.board) {
    const r = await relay(cfg, "board", { method: "POST", body: serializeBoard(dirty.board), baseRev: revs.board });
    out.board = r.rev;
  }
  if (dirty.streams) {
    const r = await relay(cfg, "streams", {
      method: "POST",
      body: serializeStreams(dirty.streams),
      baseRev: revs.streams,
    });
    out.streams = r.rev;
  }
  if (dirty.reinforcement) {
    const r = await relay(cfg, "reinforcement", {
      method: "POST",
      body: serializeReinforcement(dirty.reinforcement),
      baseRev: revs.reinforcement,
    });
    out.reinforcement = r.rev;
  }
  return out;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Initial board pull with retries for transient blips (never retries auth/busy). */
export async function pullBoardRetrying(
  cfg: SyncConfig,
  attempts = 3,
): Promise<{ state: AppState | null; rev: number }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pullBoard(cfg);
    } catch (e) {
      if (e instanceof RelayAuthError || e instanceof SyncBusyError) throw e;
      lastErr = e;
      await delay(400 * (i + 1));
    }
  }
  throw lastErr;
}

// --- React context -------------------------------------------------------------------

export interface SyncContextValue {
  config: SyncConfig | null;
  status: SyncStatus;
  /** Epoch ms until which writes are paused (0 = not paused). While this is
   * in the future, local changes are NOT reaching the relay — the UI warns,
   * because editing on a second machine in this window risks losing work. */
  pausedUntil: number;
  /** True once local changes exist that haven't been confirmed pushed. */
  hasUnsynced: boolean;
  connect: (key: string, url?: string) => void;
  disconnect: () => void;
  syncNow: () => void;
  /** Drain the relay drop box now; resolves to the number of new candidates. */
  checkInbox: () => Promise<number>;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncContext provider");
  return ctx;
}
