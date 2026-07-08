import { useEffect, useRef, useState } from "react";
import { formatDuration, projectDoneMinutes, taskMinutes, useStore } from "../store";
import { headerText, initials } from "./BoardV3";
import { squarify } from "../treemap";

// The v3 archive — cleared work as its own landscape, sized by the effort
// already spent. Completed tasks leave the active board and land here;
// clicking a box reopens its project.

export function ArchiveV3({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const { state } = useStore();
  const ref = useRef<HTMLDivElement | null>(null);
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

  const entries = state.projects
    .map((p) => ({ p, v: projectDoneMinutes(p) }))
    .filter((e) => e.v > 0);
  const count = state.projects.reduce((s, p) => s + p.tasks.filter((t) => t.done).length, 0);
  const mins = entries.reduce((s, e) => s + e.v, 0);

  const rects =
    size.w > 0 && size.h > 0 && entries.length
      ? squarify(
          entries.map((e) => ({ id: e.p.id, weight: e.v })),
          { x: 0, y: 0, w: size.w, h: size.h },
        )
      : [];

  return (
    <div className="view3">
      <div className="cap">
        <b>Archive — cleared work</b>
        <span>{count ? `${count} tasks · ${formatDuration(mins)} of effort cleared` : ""}</span>
      </div>
      <div className="frame" ref={ref} style={{ height: 480 }}>
        {entries.length === 0 && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--lo)", fontSize: 13 }}>
            Nothing cleared yet — finish a task and it lands here.
          </div>
        )}
        {rects.map((r) => {
          const entry = entries.find((e) => e.p.id === r.id);
          if (!entry) return null;
          const { p, v } = entry;
          const G = 3;
          const pos = { left: r.x + G, top: r.y + G, width: Math.max(0, r.w - 2 * G), height: Math.max(0, r.h - 2 * G) };
          const small = pos.height < 86 || pos.width < 110;
          const done = p.tasks.filter((t) => t.done);
          return (
            <div
              key={p.id}
              className={`box ${small ? "sm" : ""}`}
              style={{ ...pos, ["--c" as string]: p.color, ["--ct" as string]: headerText(p.color), opacity: 0.9 }}
              onClick={() => onOpenProject(p.id)}
            >
              <div className="bh">
                <span className="nm" title={p.name}>
                  {small ? initials(p.name) : p.name}
                </span>
                <span className="rt">
                  <span>✓ {formatDuration(v)}</span>
                </span>
              </div>
              <div className="bb">
                {done.map((t) => (
                  <div key={t.id} className="st dn" style={{ ["--m" as string]: taskMinutes(t) }}>
                    <span className="in">
                      {t.heavy ? "🔥 " : ""}
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hint">
        Sized by effort you've already spent. Completed tasks leave the active board and land here. Click a box to
        reopen its project.
      </div>
    </div>
  );
}
