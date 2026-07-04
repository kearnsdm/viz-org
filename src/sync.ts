import { createContext, useContext } from "react";
import type { AnalysisDoc, AppState, Stream } from "./types";

// Cross-device sync via a private GitHub Gist. GitHub's API sends proper CORS
// headers, so this connects reliably from the app's origin — no self-hosted
// server, no .htaccess. Auth is a personal access token with the "gist" scope,
// stored only in this browser. The whole board lives in one secret gist.

export interface SyncConfig {
  token: string;
  gistId: string;
}

export interface SyncStatus {
  phase: "idle" | "syncing" | "ok" | "error";
  at?: number;
  message?: string;
}

const SYNC_CFG_KEY = "viz-org-sync-v2";
const GIST_FILE = "viz-org-board.json";
const INBOX_FILE = "viz-org-inbox.json";
const GIST_DESC = "viz-org board (synced) — do not delete";

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && typeof c.token === "string" && typeof c.gistId === "string") return c;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(SYNC_CFG_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * GitHub meters gist *writes* (resource `gist_update`) in a separate, much
 * smaller per-user bucket than reads (`core`). Under the whole-file
 * last-write-wins sync, a burst of saves can exhaust it — then every PATCH
 * 403s while GETs keep working. This is a rate limit, NOT a bad/scopeless
 * token, so it's surfaced distinctly and callers must NOT retry it (retrying
 * only digs the hole deeper and keeps the bucket pinned at zero).
 */
export class GistRateLimitError extends Error {
  readonly resource?: string;
  /** Epoch seconds when the bucket refills, if GitHub reported it. */
  readonly resetAt?: number;
  constructor(resource?: string, resetAt?: number) {
    const when = resetAt ? ` — resets around ${new Date(resetAt * 1000).toLocaleTimeString()}` : "";
    super(`GitHub write rate limit reached${resource ? ` (${resource})` : ""}${when}. Reads still work; writes pause until it refills.`);
    this.name = "GistRateLimitError";
    this.resource = resource;
    this.resetAt = resetAt;
  }
}

async function gh(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub didn't accept that token (401)");
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resource = res.headers.get("x-ratelimit-resource") ?? undefined;
    const reset = Number(res.headers.get("x-ratelimit-reset")) || undefined;
    // A 0-remaining 403 (or any 429) is a rate limit; a 403 with quota left is a
    // real permission/scope problem.
    if (res.status === 429 || remaining === "0") throw new GistRateLimitError(resource, reset);
    throw new Error("GitHub denied the request — the token may be missing the 'gist' scope (403)");
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res;
}

function serialize(state: AppState): string {
  return JSON.stringify({ v: 1, state, savedAt: new Date().toISOString() }, null, 2);
}

/** Find the existing viz-org gist for this token, or create one seeded with the current board. */
export async function findOrCreateGist(token: string, state: AppState): Promise<SyncConfig> {
  const list = await (await gh("/gists?per_page=100", token)).json();
  const existing = Array.isArray(list)
    ? list.find((g: { files?: Record<string, unknown> }) => g.files && GIST_FILE in g.files)
    : null;
  if (existing) return { token, gistId: existing.id };
  const created = await (
    await gh("/gists", token, {
      method: "POST",
      body: JSON.stringify({
        description: GIST_DESC,
        public: false,
        files: { [GIST_FILE]: { content: serialize(state) } },
      }),
    })
  ).json();
  return { token, gistId: created.id };
}

/** Fetch the remote board, or null if the gist has nothing usable yet. */
export async function pullRemote(cfg: SyncConfig): Promise<AppState | null> {
  const gist = await (await gh(`/gists/${cfg.gistId}`, cfg.token)).json();
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
  if (!content.trim()) return null;
  const parsed = JSON.parse(content);
  if (parsed && parsed.state) return parsed.state as AppState;
  if (parsed && Array.isArray(parsed.projects)) return parsed as AppState;
  return null;
}

/** Save the whole board to the gist. */
export async function pushRemote(cfg: SyncConfig, state: AppState): Promise<void> {
  await gh(`/gists/${cfg.gistId}`, cfg.token, {
    method: "PATCH",
    body: JSON.stringify({ files: { [GIST_FILE]: { content: serialize(state) } } }),
  });
}

// --- Gist inbox -----------------------------------------------------------
// A second file in the same private gist acts as a drop box: anything that
// can write to the gist (e.g. a Claude email scan) leaves candidate tasks
// there, and the app ingests them into Email Intake on load/focus.

/** Raw contents of the gist inbox drop box, or null if empty/absent. */
export async function pullInbox(cfg: SyncConfig): Promise<string | null> {
  const gist = await (await gh(`/gists/${cfg.gistId}`, cfg.token)).json();
  const file = gist.files?.[INBOX_FILE];
  if (!file) return null;
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
  const trimmed = content.trim();
  return trimmed && trimmed !== "[]" ? trimmed : null;
}

/** Empty the drop box once its contents have been ingested. */
export async function clearInbox(cfg: SyncConfig): Promise<void> {
  await gh(`/gists/${cfg.gistId}`, cfg.token, {
    method: "PATCH",
    body: JSON.stringify({ files: { [INBOX_FILE]: { content: "[]" } } }),
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pullRemoteRetrying(cfg: SyncConfig, attempts = 3): Promise<AppState | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pullRemote(cfg);
    } catch (e) {
      if (e instanceof GistRateLimitError) throw e; // never retry a rate limit
      lastErr = e;
      await delay(400 * (i + 1));
    }
  }
  throw lastErr;
}

export async function pushRemoteRetrying(cfg: SyncConfig, state: AppState, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pushRemote(cfg, state);
    } catch (e) {
      // A rate-limited write must not be retried — each attempt burns more of
      // the exhausted gist_update budget and keeps it pinned at zero.
      if (e instanceof GistRateLimitError) throw e;
      lastErr = e;
      await delay(400 * (i + 1));
    }
  }
  throw lastErr;
}

export interface SyncContextValue {
  config: SyncConfig | null;
  status: SyncStatus;
  connect: (token: string) => void;
  disconnect: () => void;
  syncNow: () => void;
  /** Drain the gist drop box now; resolves to the number of new candidates. */
  checkInbox: () => Promise<number>;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncContext provider");
  return ctx;
}

// --- v3: checklist streams (a third file in the same private gist) --------
// Mirrors the board/inbox helpers above. The whole checklist registry lives in
// one file so it round-trips independently of board state — a bridge write here
// never clobbers the board, and vice versa.

const STREAMS_FILE = "viz-org-streams.json";

function serializeStreams(streams: Stream[]): string {
  return JSON.stringify({ v: 3, streams, savedAt: new Date().toISOString() }, null, 2);
}

/** Fetch the remote checklist streams, or [] if the file is empty/absent. */
export async function pullStreams(cfg: SyncConfig): Promise<Stream[]> {
  const gist = await (await gh(`/gists/${cfg.gistId}`, cfg.token)).json();
  const file = gist.files?.[STREAMS_FILE];
  if (!file) return [];
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
  if (!content.trim()) return [];
  const parsed = JSON.parse(content);
  if (parsed && Array.isArray(parsed.streams)) return parsed.streams as Stream[];
  if (Array.isArray(parsed)) return parsed as Stream[];
  return [];
}

/** Save all checklist streams to the gist (whole-file replace). */
export async function pushStreams(cfg: SyncConfig, streams: Stream[]): Promise<void> {
  await gh(`/gists/${cfg.gistId}`, cfg.token, {
    method: "PATCH",
    body: JSON.stringify({ files: { [STREAMS_FILE]: { content: serializeStreams(streams) } } }),
  });
}

// --- v3: the Analysis tab (read-only) ---------------------------------------
// viz-org-analysis.json is AUTHORED BY CLAUDE via the bridge; the app only
// renders it. There is deliberately no pushAnalysis — the app never writes
// this file (the contract ledger inside it is not the app's to run).

const ANALYSIS_FILE = "viz-org-analysis.json";

/** Fetch the analysis document, or null if absent/unreadable. */
export async function pullAnalysis(cfg: SyncConfig): Promise<AnalysisDoc | null> {
  const gist = await (await gh(`/gists/${cfg.gistId}`, cfg.token)).json();
  const file = gist.files?.[ANALYSIS_FILE];
  if (!file) return null;
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? (parsed as AnalysisDoc) : null;
  } catch {
    return null;
  }
}
