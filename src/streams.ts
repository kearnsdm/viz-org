import { createContext, useContext } from "react";
import type { Stream, StreamItem, StreamEvent, StreamEventKind } from "./types";

// Checklist "streams" live in their own store, separate from the board reducer
// in store.ts, with their own localStorage key and their own gist file
// (viz-org-streams.json). Nothing here mutates AppState.

export const STREAMS_STORAGE_KEY = "viz-org-streams-v3";

export function sid(prefix = "str"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

// --- recall defaults -------------------------------------------------------
// Auto-assigned at creation, overridable via the picker (installment 4).
// Codenames are evocative + concrete so a stream is easy to recall by name;
// the default glyph is neutral until the user picks a real one.

const CODENAME_BANK = [
  "Tidewater", "Heron", "Lantern", "Cypress", "Meridian", "Quarry", "Beacon",
  "Thistle", "Harbor", "Ember", "Marlin", "Cedar", "Anchor", "Drift", "Slate",
  "Vesper", "Cove", "Birch", "Reef", "Kestrel", "Foundry", "Willow", "Cairn",
  "Saffron", "Bramble", "Halyard", "Pike", "Juniper", "Solstice", "Wren",
];

const DEFAULT_GLYPHS = ["📌", "🪧", "🧭", "🗂️", "🪵", "🌿", "⚓", "🔭", "🕯️", "🧱"];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A codename not already used inside the same category. */
export function autoCodename(seed: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  const start = hashStr(seed) % CODENAME_BANK.length;
  for (let i = 0; i < CODENAME_BANK.length; i++) {
    const name = CODENAME_BANK[(start + i) % CODENAME_BANK.length];
    if (!used.has(name.toLowerCase())) return name;
  }
  return `${CODENAME_BANK[start]}-${(used.size + 1)}`; // bank exhausted within a category
}

export function defaultGlyph(category: string): string {
  return DEFAULT_GLYPHS[hashStr(category || "default") % DEFAULT_GLYPHS.length];
}

// --- persistence -----------------------------------------------------------

function normalizeStream(raw: unknown): Stream | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const items: StreamItem[] = Array.isArray(s.items)
    ? (s.items as unknown[])
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as { id?: unknown }).id === "string")
        .map((i) => ({
          id: String(i.id),
          text: typeof i.text === "string" ? i.text : "",
          state: i.state === "done" || i.state === "dropped" ? i.state : "open",
          addedAt: typeof i.addedAt === "number" ? i.addedAt : Date.now(),
          closedAt: typeof i.closedAt === "number" ? i.closedAt : undefined,
        }))
    : [];
  const created = typeof s.createdAt === "number" ? s.createdAt : Date.now();
  return {
    streamId: typeof s.streamId === "string" ? s.streamId : sid(),
    taskId: typeof s.taskId === "string" ? s.taskId : null,
    name: typeof s.name === "string" ? s.name : "Untitled",
    aliases: Array.isArray(s.aliases) ? (s.aliases as unknown[]).filter((a): a is string => typeof a === "string") : [],
    codename: typeof s.codename === "string" ? s.codename : "",
    category: typeof s.category === "string" ? s.category : "",
    glyph: typeof s.glyph === "string" ? s.glyph : "",
    tintIndex: typeof s.tintIndex === "number" ? s.tintIndex : 0,
    items,
    history: Array.isArray(s.history) ? (s.history as StreamEvent[]) : [],
    createdAt: created,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : created,
  };
}

export function loadStreams(): Stream[] {
  try {
    const raw = localStorage.getItem(STREAMS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { streams?: unknown }).streams)
          ? (parsed as { streams: unknown[] }).streams
          : [];
      return arr.map(normalizeStream).filter((s): s is Stream => s !== null);
    }
  } catch {
    /* fall through to empty */
  }
  return [];
}

export function saveStreams(streams: Stream[]): void {
  try {
    localStorage.setItem(STREAMS_STORAGE_KEY, JSON.stringify(streams));
  } catch {
    /* best-effort */
  }
}

/** Merge remote streams into local, last-write-wins by updatedAt PER STREAM.
 * Identity-preserving: when the merge changes nothing, the ORIGINAL array is
 * returned (same reference) — a fresh array would read as "state changed",
 * trigger a push, bump the revision, and ping-pong forever with every other
 * open device syncing the same data. */
export function mergeStreams(local: Stream[], remote: Stream[]): Stream[] {
  const byId = new Map<string, Stream>();
  for (const s of local) byId.set(s.streamId, s);
  let changed = false;
  for (const r of remote) {
    const cur = byId.get(r.streamId);
    if (!cur || r.updatedAt > cur.updatedAt) {
      byId.set(r.streamId, r);
      changed = true;
    }
  }
  return changed ? [...byId.values()] : local;
}

// --- resolution (you refer to streams by name/alias/codename, never id) ----

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Every stream that plausibly matches a free-text reference. */
export function matchStreams(streams: Stream[], query: string): Stream[] {
  const q = norm(query);
  if (!q) return [];
  const exact = streams.filter(
    (s) => norm(s.name) === q || norm(s.codename) === q || s.aliases.some((a) => norm(a) === q),
  );
  if (exact.length) return exact;
  const prefix = streams.filter((s) => norm(s.name).startsWith(q) || norm(s.codename).startsWith(q));
  if (prefix.length) return prefix;
  return streams.filter(
    (s) => norm(s.name).includes(q) || s.codename.toLowerCase().includes(q) || s.aliases.some((a) => norm(a).includes(q)),
  );
}

/** Resolve a reference to a single stream, or null if absent/ambiguous. */
export function resolveStream(streams: Stream[], query: string): Stream | null {
  const hits = matchStreams(streams, query);
  return hits.length === 1 ? hits[0] : null;
}

// --- reducer ---------------------------------------------------------------

export type StreamAction =
  | { type: "create"; name: string; category: string; taskId?: string | null; aliases?: string[]; items?: string[]; codename?: string; glyph?: string; tintIndex?: number }
  | { type: "bind"; streamId: string; taskId: string }
  | { type: "addAlias"; streamId: string; alias: string }
  | { type: "addItem"; streamId: string; text: string }
  | { type: "check"; streamId: string; itemId: string }
  | { type: "uncheck"; streamId: string; itemId: string }
  | { type: "drop"; streamId: string; itemId: string }
  | { type: "rename"; streamId: string; name: string }
  | { type: "replan"; streamId: string; items: string[] }
  | { type: "setGlyph"; streamId: string; glyph: string }
  | { type: "setCodename"; streamId: string; codename: string }
  | { type: "setTint"; streamId: string; tintIndex: number }
  | { type: "remove"; streamId: string }
  | { type: "ingest"; streams: Stream[] }
  | { type: "replaceAll"; streams: Stream[] };

function ev(kind: StreamEventKind, itemId?: string, detail?: string): StreamEvent {
  return { at: Date.now(), kind, itemId, detail };
}

function touch(s: Stream, event: StreamEvent, items?: StreamItem[]): Stream {
  return { ...s, items: items ?? s.items, history: [...s.history, event], updatedAt: event.at };
}

function mapStream(streams: Stream[], streamId: string, fn: (s: Stream) => Stream): Stream[] {
  return streams.map((s) => (s.streamId === streamId ? fn(s) : s));
}

export function streamsReducer(streams: Stream[], action: StreamAction): Stream[] {
  switch (action.type) {
    case "create": {
      const id = sid();
      const category = action.category ?? "";
      const codename =
        action.codename ??
        autoCodename(id, streams.filter((s) => s.category === category).map((s) => s.codename));
      const items: StreamItem[] = (action.items ?? []).map((text) => ({
        id: sid("itm"),
        text,
        state: "open",
        addedAt: Date.now(),
      }));
      const now = Date.now();
      const stream: Stream = {
        streamId: id,
        taskId: action.taskId ?? null,
        name: action.name.trim() || "Untitled",
        aliases: action.aliases ?? [],
        codename,
        category,
        glyph: action.glyph ?? defaultGlyph(category),
        tintIndex: action.tintIndex ?? 0,
        items,
        history: [ev("create")],
        createdAt: now,
        updatedAt: now,
      };
      return [...streams, stream];
    }
    case "bind":
      return mapStream(streams, action.streamId, (s) =>
        touch({ ...s, taskId: action.taskId }, ev("bind", undefined, action.taskId)),
      );
    case "addAlias":
      return mapStream(streams, action.streamId, (s) =>
        s.aliases.includes(action.alias) ? s : { ...s, aliases: [...s.aliases, action.alias], updatedAt: Date.now() },
      );
    case "addItem":
      return mapStream(streams, action.streamId, (s) => {
        const item: StreamItem = { id: sid("itm"), text: action.text, state: "open", addedAt: Date.now() };
        return touch(s, ev("add", item.id), [...s.items, item]);
      });
    case "check":
      return mapStream(streams, action.streamId, (s) =>
        touch(
          s,
          ev("check", action.itemId),
          s.items.map((i) => (i.id === action.itemId ? { ...i, state: "done", closedAt: Date.now() } : i)),
        ),
      );
    case "uncheck":
      return mapStream(streams, action.streamId, (s) =>
        touch(
          s,
          ev("uncheck", action.itemId),
          s.items.map((i) => (i.id === action.itemId ? { ...i, state: "open", closedAt: undefined } : i)),
        ),
      );
    case "drop":
      return mapStream(streams, action.streamId, (s) =>
        touch(
          s,
          ev("drop", action.itemId),
          s.items.map((i) => (i.id === action.itemId ? { ...i, state: "dropped", closedAt: Date.now() } : i)),
        ),
      );
    case "rename":
      return mapStream(streams, action.streamId, (s) =>
        touch({ ...s, name: action.name.trim() || s.name }, ev("rename", undefined, action.name)),
      );
    case "replan":
      return mapStream(streams, action.streamId, (s) => {
        // Preserve closed items (done/dropped) as history. For currently-open
        // items: keep ones whose text reappears in the new list; drop the rest.
        const wanted = action.items.map((t) => t.trim()).filter(Boolean);
        const wantedNorm = new Map(wanted.map((t) => [norm(t), t] as const));
        const kept: StreamItem[] = [];
        const closed = s.items.filter((i) => i.state !== "open");
        const stillOpen = new Set<string>();
        for (const i of s.items) {
          if (i.state !== "open") continue;
          if (wantedNorm.has(norm(i.text))) {
            kept.push(i);
            stillOpen.add(norm(i.text));
          } else {
            kept.push({ ...i, state: "dropped", closedAt: Date.now() }); // folded to history
          }
        }
        const added: StreamItem[] = wanted
          .filter((t) => !stillOpen.has(norm(t)))
          .map((text) => ({ id: sid("itm"), text, state: "open", addedAt: Date.now() }));
        const items = [...closed.filter((c) => !kept.includes(c)), ...kept, ...added];
        return touch(s, ev("replan", undefined, `${wanted.length} open after replan`), items);
      });
    case "setGlyph":
      return mapStream(streams, action.streamId, (s) => ({ ...s, glyph: action.glyph, updatedAt: Date.now() }));
    case "setCodename":
      return mapStream(streams, action.streamId, (s) => ({ ...s, codename: action.codename.trim() || s.codename, updatedAt: Date.now() }));
    case "setTint":
      return mapStream(streams, action.streamId, (s) => ({ ...s, tintIndex: Math.max(0, Math.round(action.tintIndex)), updatedAt: Date.now() }));
    case "remove":
      return streams.filter((s) => s.streamId !== action.streamId);
    case "ingest":
      return mergeStreams(streams, action.streams);
    case "replaceAll":
      return action.streams;
    default:
      return streams;
  }
}

// --- selectors -------------------------------------------------------------

export function openItems(s: Stream): StreamItem[] {
  return s.items.filter((i) => i.state === "open");
}

export function progress(s: Stream): { done: number; total: number } {
  const total = s.items.filter((i) => i.state !== "dropped").length;
  const done = s.items.filter((i) => i.state === "done").length;
  return { done, total };
}

/** Streams with no bound board task — the "Unbound" tray. */
export function unboundStreams(streams: Stream[]): Stream[] {
  return streams.filter((s) => s.taskId === null);
}

// --- React context ---------------------------------------------------------

export interface StreamsContextValue {
  streams: Stream[];
  dispatch: (action: StreamAction) => void;
}

export const StreamsContext = createContext<StreamsContextValue | null>(null);

export function useStreams(): StreamsContextValue {
  const ctx = useContext(StreamsContext);
  if (!ctx) throw new Error("useStreams must be used within a StreamsProvider");
  return ctx;
}
