import { createContext, useContext } from "react";
import type { AppState } from "./types";

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
  if (res.status === 403) throw new Error("GitHub rate limit or token missing 'gist' scope (403)");
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
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncContext provider");
  return ctx;
}
