import { createContext, useContext } from "react";
import type { AppState } from "./types";

// Automatic cross-device sync against a tiny PHP endpoint the user hosts on
// their own site (e.g. DreamHost). The whole board is stored as one JSON blob,
// protected by a passphrase sent in the X-Viz-Key header. Model is last-write-
// wins, which is right for one person syncing across their own devices.

export interface SyncConfig {
  url: string;
  key: string;
}

export interface SyncStatus {
  phase: "idle" | "syncing" | "ok" | "error";
  at?: number;
  message?: string;
}

const SYNC_CFG_KEY = "viz-org-sync-v1";

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

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(SYNC_CFG_KEY);
  } catch {
    /* ignore */
  }
}

/** Build the endpoint URL with the passphrase as a query param. */
function withKey(url: string, key: string): string {
  const u = new URL(url);
  u.searchParams.set("key", key);
  return u.toString();
}

// Both calls are deliberately "simple" cross-origin requests — no custom
// headers, and a text/plain content type — so the browser never sends a CORS
// preflight. That avoids the most common cross-site failures with shared hosts.

/** Fetch the remote board, or null if the server has nothing stored yet. */
export async function pullRemote(cfg: SyncConfig): Promise<AppState | null> {
  const res = await fetch(withKey(cfg.url, cfg.key), { method: "GET" });
  if (res.status === 401) throw new Error("Wrong passphrase (401)");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  return data && data.state ? (data.state as AppState) : null;
}

/** Save the whole board to the remote endpoint. */
export async function pushRemote(cfg: SyncConfig, state: AppState): Promise<void> {
  const res = await fetch(withKey(cfg.url, cfg.key), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ state, savedAt: new Date().toISOString() }),
  });
  if (res.status === 401) throw new Error("Wrong passphrase (401)");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull, retrying a few times so a momentary blip doesn't surface as an error. */
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

/** Push, retrying a few times before reporting failure. */
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
  connect: (cfg: SyncConfig) => void;
  disconnect: () => void;
  syncNow: () => void;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncContext provider");
  return ctx;
}
