import { useEffect, useRef, useState } from "react";
import { allocatedSlots, freeSlots, projectWeight, useStore } from "../store";
import { squarify, type TreemapItem } from "../treemap";
import type { Project } from "../types";

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

const FREE_ID = "__free__";

function ProjectBox({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  const total = projectWeight(project);
  const done = project.tasks.filter((t) => t.done).length;
  const open = project.tasks.length - done;
  const urgent = project.tasks.filter((t) => !t.done && (t.urgency === "urgent" || t.urgency === "high")).length;
  const freeInProject = Math.max(0, project.capacity - project.tasks.length);
  const fillPct = Math.round((project.tasks.length / total) * 100);

  return (
    <button
      className="project-box"
      style={{ ["--accent" as string]: project.color }}
      onClick={onOpen}
      title={`${project.name} — click to open and plan`}
    >
      <span className="project-box__fill" style={{ width: `${fillPct}%` }} aria-hidden />
      <span className="project-box__body">
        <span className="project-box__name">
          {project.isAdmin && <span className="pill pill-admin">admin</span>}
          {project.name}
        </span>
        <span className="project-box__meta">
          <span>{open} open</span>
          {done > 0 && <span className="muted">· {done} done</span>}
          {urgent > 0 && <span className="pill pill-urgent">{urgent} pressing</span>}
          {freeInProject > 0 && <span className="muted">· {freeInProject} free</span>}
        </span>
      </span>
    </button>
  );
}

export function Board({
  onOpenProject,
  onAddProject,
}: {
  onOpenProject: (id: string) => void;
  onAddProject: () => void;
}) {
  const { state } = useStore();
  const { ref, size } = useMeasure<HTMLDivElement>();

  const free = freeSlots(state);
  const items: TreemapItem[] = state.projects.map((p) => ({ id: p.id, weight: projectWeight(p) }));
  if (free > 0) items.push({ id: FREE_ID, weight: free });

  const rects =
    size.w > 0 && size.h > 0 ? squarify(items, { x: 0, y: 0, w: size.w, h: size.h }) : [];

  const usedPct = Math.round((allocatedSlots(state) / state.boardCapacity) * 100);

  return (
    <div className="board-panel">
      <div className="board-heading">
        <h2>The Board</h2>
        <p className="muted">
          Everything you could spend time on, sized by how much it holds.{" "}
          <strong>{usedPct}%</strong> of your time is allocated.
        </p>
      </div>
      <div className="board-canvas" ref={ref}>
        {rects.map((r) => {
          const stylePos = {
            left: r.x,
            top: r.y,
            width: Math.max(0, r.w - 6),
            height: Math.max(0, r.h - 6),
          };
          if (r.id === FREE_ID) {
            return (
              <div key={r.id} className="free-box" style={stylePos}>
                <button className="free-box__btn" onClick={onAddProject}>
                  <span className="free-box__plus">+</span>
                  <span>Unallocated time</span>
                  <span className="muted">{free} slots — claim it for a project</span>
                </button>
              </div>
            );
          }
          const project = state.projects.find((p) => p.id === r.id);
          if (!project) return null;
          return (
            <div key={r.id} className="box-slot" style={stylePos}>
              <ProjectBox project={project} onOpen={() => onOpenProject(project.id)} />
            </div>
          );
        })}
        {rects.length === 0 && <div className="board-empty muted">Measuring your world…</div>}
      </div>
    </div>
  );
}
