import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  formatDuration,
  heldItems,
  projectAllocMinutes,
  projectDoneMinutes,
  projectHeldMinutes,
  projectWorkMinutes,
  spotlightPick,
  taskMinutes,
  useStore,
  weeklyBudgetMinutes,
} from "../store";
import { progress, useStreams } from "../streams";
import { squarify } from "../treemap";
import type { Project, Task } from "../types";

// The v3 board — the "Continuous Landscape". One bounded treemap; near-zero
// gaps (1px seams), 4px corners; category hue tints the whole box, anchored by
// a solid saturated header. Two size modes: Intended (capacity hours, with
// unfilled bands and overflow lips) and Actual (booked minutes). Hover a
// stripe to reveal its checkbox (complete with Undo) and chevron (open sheet).

export type BoardMode = "alloc" | "actual" | "holding";

/** Header text flips light/dark per hue for legibility. */
export function headerText(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length < 6) return "#fff";
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#101216" : "#fff";
}

export function initials(name: string): string {
  return name
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The intended-hours figure, edited in place — click to type, Enter/blur
 * saves, Escape cancels. No modal, no edit mode. `capacity` is read as hours
 * (v3's reading of project.capacity); onSave hands back the new hour count for
 * the existing setCapacity action. Pass `stop` inside a clickable box so
 * editing doesn't also open the box.
 */
export function InlineHours({
  capacity,
  onSave,
  stop,
}: {
  capacity: number;
  onSave: (hours: number) => void;
  stop?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(capacity));
  const halt = (e: { stopPropagation: () => void }) => {
    if (stop) e.stopPropagation();
  };
  const commit = () => {
    const n = parseFloat(val);
    if (!Number.isNaN(n) && n > 0) onSave(n);
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        className="hours-edit"
        type="number"
        min={1}
        step={1}
        value={val}
        autoFocus
        onClick={halt}
        onMouseDown={halt}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setVal(String(capacity));
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className="hours-edit-trigger"
      title="Click to edit intended hours"
      onClick={(e) => {
        halt(e);
        setVal(String(capacity));
        setEditing(true);
      }}
    >
      {formatDuration(Math.round(capacity * 60)) || "0m"}
    </span>
  );
}

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return { ref, size };
}

/** Projects under this share of the board fold into the "Other" group. */
const OTHER_SHARE = 0.05;
const GROUP_ID = "__other__";

interface BoardV3Props {
  onOpenProject: (projectId: string) => void;
  onOpenTask: (projectId: string, taskId: string) => void;
  onStartSprint: (projectId: string, taskId?: string) => void;
  notify: (msg: string, undo?: () => void) => void;
}

function ProjectBoxV3({
  project,
  w,
  h,
  pos,
  mode,
  simple,
  spotlightTask,
  onOpen,
  onOpenTask,
  onStartSprint,
  notify,
}: {
  project: Project;
  w: number;
  h: number;
  pos: CSSProperties;
  mode: BoardMode;
  simple: boolean;
  spotlightTask: Task | null;
  onOpen: () => void;
  onOpenTask: (taskId: string) => void;
  onStartSprint: (taskId?: string) => void;
  notify: (msg: string, undo?: () => void) => void;
}) {
  const { dispatch } = useStore();
  const { streams } = useStreams();
  const open = project.tasks.filter((t) => !t.done);
  const openMin = projectWorkMinutes(project);
  const doneMin = projectDoneMinutes(project);
  const alloc = projectAllocMinutes(project) || openMin;
  const over = Math.max(0, openMin - alloc);
  const remain = Math.max(0, alloc - openMin);
  const pc = Math.round((100 * doneMin) / (openMin + doneMin || 1));
  const urgent = open.some((t) => t.urgency === "urgent");
  const small = h < 86 || w < 110;
  const ct = headerText(project.color);

  const complete = (t: Task) => {
    dispatch({ type: "toggleTask", projectId: project.id, taskId: t.id });
    notify(`✓ ${t.title}`, () => dispatch({ type: "undoComplete", projectId: project.id, taskId: t.id }));
  };

  const header =
    mode === "alloc" ? (
      <span>
        <InlineHours
          capacity={project.capacity}
          stop
          onSave={(hours) => dispatch({ type: "setCapacity", projectId: project.id, capacity: hours })}
        />
        {over > 0 ? (
          <>
            {" · "}
            <span className="over">+{formatDuration(over)} over</span>
          </>
        ) : remain > 0 ? (
          <> · {formatDuration(remain)} free</>
        ) : null}
      </span>
    ) : (
      <span>{formatDuration(openMin) || "0m"}</span>
    );

  return (
    <div
      className={`box ${project.tier === "elevated" ? "elev" : ""} ${project.tier === "dimmed" ? "dim" : ""} ${
        spotlightTask ? "spot" : ""
      } ${small ? "sm" : ""}`}
      style={{ ...pos, ["--c" as string]: project.color, ["--ct" as string]: ct }}
      onClick={onOpen}
      title={`${project.name} — ${formatDuration(openMin) || "0m"} booked · click to open`}
    >
      <div className="bh">
        <span className="nm" title={project.name}>
          {small ? initials(project.name) : project.name}
        </span>
        <span className="rt">
          {urgent && <span className="dot" />}
          {header}
        </span>
      </div>
      <div className="pr">
        <i style={{ width: `${pc}%` }} />
      </div>
      <div className="bb">
        {!simple && spotlightTask && (
          <button
            className="start"
            onClick={(e) => {
              e.stopPropagation();
              onStartSprint(spotlightTask.id);
            }}
          >
            ▶ Start here — {spotlightTask.title} · ~{taskMinutes(spotlightTask)} min
          </button>
        )}
        {!simple && open.map((t) => {
          const stream = streams.find((s) => s.taskId === t.id);
          const prog = stream ? progress(stream) : null;
          const pressing = t.urgency === "urgent" || t.urgency === "high";
          return (
            <div
              key={t.id}
              className={`st ${pressing ? "ur" : ""}`}
              style={{ ["--m" as string]: taskMinutes(t) }}
              title={`${t.title} · ${formatDuration(taskMinutes(t))}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenTask(t.id);
              }}
            >
              <button
                className="cbx"
                title="Mark done"
                onClick={(e) => {
                  e.stopPropagation();
                  complete(t);
                }}
              >
                ✓
              </button>
              <span className="in">
                {t.heavy ? "🔥 " : ""}
                {t.title}
              </span>
              {prog && prog.total > 0 && (
                <span className="comps-badge">
                  ▤ {prog.done}/{prog.total}
                </span>
              )}
              <span className="chev">›</span>
            </div>
          );
        })}
        {mode === "alloc" && remain > 0 && (
          <div className="rem" style={{ ["--m" as string]: remain }}>
            {remain >= 20 ? `${formatDuration(remain)} unfilled` : ""}
          </div>
        )}
      </div>
      {mode === "alloc" && over > 0 && (
        <div className="lip" style={{ height: Math.min(46, 18 + over / 6) }}>
          +{formatDuration(over)} over intended
        </div>
      )}
    </div>
  );
}

export function BoardV3({ onOpenProject, onOpenTask, onStartSprint, notify }: BoardV3Props) {
  const { state, dispatch } = useStore();
  const { ref, size } = useMeasure<HTMLDivElement>();
  const [grpOpen, setGrpOpen] = useState(false);
  const [mode, setMode] = useState<BoardMode>("alloc");
  const [density, setDensity] = useState<"full" | "simple">("full");
  const hours = state.weeklyHours ?? 40;
  // Overview: the space itself — allocations + runover, no individual task
  // stripes, and every small category as its own box (no "Other" fold-in).
  const simple = density === "simple" && mode !== "holding";

  const sizeOf = (p: Project) =>
    mode === "holding"
      ? projectHeldMinutes(p)
      : mode === "alloc"
        ? projectAllocMinutes(p) || projectWorkMinutes(p)
        : projectWorkMinutes(p);

  const spot = mode === "holding" ? null : spotlightPick(state);
  const held = heldItems(state);
  const heldMin = held.reduce((s, i) => s + taskMinutes(i.task), 0);
  const nextReturn = held[0]?.task.scheduledFor;

  const entries = state.projects.map((p) => ({ p, v: sizeOf(p) })).filter((e) => e.v > 0);
  const total = entries.reduce((s, e) => s + e.v, 0) || 1;

  // The smallest categories fold into one expandable "Other" box.
  let nodes: Array<{ p?: Project; grp?: Array<{ p: Project; v: number }>; v: number; id: string }> = entries.map(
    (e) => ({ p: e.p, v: e.v, id: e.p.id }),
  );
  if (!grpOpen && mode !== "holding" && !simple) {
    const small = entries.filter((e) => e.v / total < OTHER_SHARE);
    if (small.length >= 2) {
      const ids = new Set(small.map((e) => e.p.id));
      nodes = nodes.filter((n) => !ids.has(n.id));
      nodes.push({ grp: small, v: small.reduce((s, e) => s + e.v, 0), id: GROUP_ID });
    }
  }

  const rects =
    size.w > 0 && size.h > 0
      ? squarify(
          nodes.map((n) => ({ id: n.id, weight: n.v })),
          { x: 0, y: 0, w: size.w, h: size.h },
        )
      : [];

  // Summary + the done rail.
  let booked = 0;
  let done = 0;
  let allocTotal = 0;
  let overTotal = 0;
  for (const p of state.projects) {
    const o = projectWorkMinutes(p);
    booked += o;
    done += projectDoneMinutes(p);
    const a = projectAllocMinutes(p) || o;
    allocTotal += a;
    overTotal += Math.max(0, o - a);
  }
  const budget = weeklyBudgetMinutes(state);
  const dpc = Math.min(100, Math.round((100 * done) / Math.max(1, budget)));
  const bpc = Math.min(100, Math.round((100 * (done + booked)) / Math.max(1, budget)));

  return (
    <div className="view3">
      <div className="cap">
        <b>The landscape</b>
        <div className="modebar">
          <button className={mode === "alloc" ? "on" : ""} onClick={() => setMode("alloc")}>
            Intended
          </button>
          <button className={mode === "actual" ? "on" : ""} onClick={() => setMode("actual")}>
            Actual
          </button>
          <button className={mode === "holding" ? "on" : ""} onClick={() => setMode("holding")}>
            Holding{held.length ? ` (${held.length})` : ""}
          </button>
        </div>
        {mode !== "holding" && (
          <div className="modebar" title="Show task stripes, or just the space (allocations + runover)">
            <button className={density === "full" ? "on" : ""} onClick={() => setDensity("full")}>
              Tasks
            </button>
            <button className={density === "simple" ? "on" : ""} onClick={() => setDensity("simple")}>
              Overview
            </button>
          </div>
        )}
        <span>
          {mode === "holding"
            ? held.length
              ? `${held.length} held · ${formatDuration(heldMin)} parked off the board — next return ${nextReturn?.slice(5) ?? "—"}`
              : "nothing held — park a task from its sheet"
            : mode === "alloc"
            ? `planned ${formatDuration(allocTotal) || "0m"} · booked ${formatDuration(booked) || "0m"}${
                overTotal ? ` · ${formatDuration(overTotal)} over plan` : ""
              } · ${formatDuration(done) || "0m"} done`
            : `${formatDuration(booked) || "0m"} remaining · ${formatDuration(done) || "0m"} done`}
        </span>
        <span className="sp" />
        <span className="wbud">
          weekly budget
          <button className="wstep" title="−1h" onClick={() => dispatch({ type: "setWeeklyHours", hours: hours - 1 })}>
            −
          </button>
          <input
            type="number"
            min={1}
            value={hours}
            onChange={(e) => dispatch({ type: "setWeeklyHours", hours: Number(e.target.value) })}
          />
          <button className="wstep" title="+1h" onClick={() => dispatch({ type: "setWeeklyHours", hours: hours + 1 })}>
            +
          </button>
          h/wk
        </span>
      </div>
      {mode !== "holding" && (
        <div className="rail" style={{ ["--dpc" as string]: `${dpc}%`, ["--bpc" as string]: `${bpc}%` }} />
      )}
      <div className="frame board-frame" ref={ref}>
        {mode === "holding" && held.length === 0 && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--lo)", fontSize: 13 }}>
            The pen is empty. Open a task's sheet and "⏸ Hold" it — it leaves the board until its return date.
          </div>
        )}
        {rects.map((r) => {
          const G = 1;
          const pos = {
            left: r.x + G,
            top: r.y + G,
            width: Math.max(0, r.w - 2 * G),
            height: Math.max(0, r.h - 2 * G),
          };
          const node = nodes.find((n) => n.id === r.id);
          if (!node) return null;
          if (node.grp) {
            return (
              <div
                key={GROUP_ID}
                className="box"
                style={{ ...pos, position: "absolute", ["--c" as string]: "#566073", ["--ct" as string]: "#eef1f5" }}
              >
                <div className="bh" style={{ cursor: "pointer" }} title="Tap to expand" onClick={() => setGrpOpen(true)}>
                  <span className="nm">Other</span>
                  <span className="rt">
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {node.grp.map((e) => (
                        <i
                          key={e.p.id}
                          style={{ width: 9, height: 9, borderRadius: 2, background: e.p.color, display: "inline-block" }}
                        />
                      ))}
                    </span>
                    <span>{formatDuration(node.v)}</span>
                  </span>
                </div>
                <div className="bb">
                  {node.grp.map((e) => (
                    <div key={e.p.id} className="orow" onClick={() => onOpenProject(e.p.id)}>
                      <span className="sub3" style={{ background: e.p.color, color: headerText(e.p.color) }}>
                        {e.p.name.trim()[0]?.toUpperCase()}
                      </span>
                      <span className="onm">{e.p.name}</span>
                      <span className="hm">{formatDuration(e.v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          const project = node.p!;
          if (mode === "holding") {
            // The Holding landscape: same grammar (hue = category, area =
            // minutes), but boxes hold parked stripes sorted by return date.
            const parked = project.tasks
              .filter((t) => t.held && !t.done)
              .sort((a, b) => (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999"));
            const small = (pos.height as number) < 86 || (pos.width as number) < 110;
            return (
              <div
                key={project.id}
                className={`box ${small ? "sm" : ""}`}
                style={{ ...pos, ["--c" as string]: project.color, ["--ct" as string]: headerText(project.color) }}
                onClick={() => onOpenProject(project.id)}
              >
                <div className="bh">
                  <span className="nm" title={project.name}>
                    {small ? initials(project.name) : project.name}
                  </span>
                  <span className="rt">
                    <span>⏸ {formatDuration(projectHeldMinutes(project))}</span>
                  </span>
                </div>
                <div className="bb">
                  {parked.map((t) => (
                    <div
                      key={t.id}
                      className="st"
                      style={{ ["--m" as string]: taskMinutes(t) }}
                      title={`${t.title} — returns ${t.scheduledFor}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTask(project.id, t.id);
                      }}
                    >
                      <span className="in">
                        {t.heavy ? "🔥 " : ""}
                        {t.title}
                      </span>
                      <span className="retn">
                        {formatDuration(taskMinutes(t))} · ↩ {t.scheduledFor?.slice(5) ?? "—"}
                      </span>
                      <span className="chev">›</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <ProjectBoxV3
              key={project.id}
              project={project}
              w={pos.width}
              h={pos.height}
              pos={pos}
              mode={mode}
              simple={simple}
              spotlightTask={spot && spot.project.id === project.id ? spot.task : null}
              onOpen={() => onOpenProject(project.id)}
              onOpenTask={(taskId) => onOpenTask(project.id, taskId)}
              onStartSprint={(taskId) => onStartSprint(project.id, taskId)}
              notify={notify}
            />
          );
        })}
      </div>
      <div className="hint">
        Click any box to open its task screen. Week = the same surface, zoomed to the near slice.
        {grpOpen && (
          <>
            {" · "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setGrpOpen(false);
              }}
            >
              ⊙ regroup
            </a>
          </>
        )}
      </div>
    </div>
  );
}
