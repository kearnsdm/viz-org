import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { pullAnalysis, useSync } from "../sync";
import { isoDate } from "../game";
import { effectiveEvents, useReinforcement } from "../reinforcement";
import type { AnalysisDoc, AnalysisFinding } from "../types";

// The v3 Analysis tab — where divergence flags live now (never on the board;
// the board is a glance surface, diagnosis is deliberate). The findings are
// AUTHORED BY CLAUDE via the bridge: it reads board + stream history from the
// gist and writes viz-org-analysis.json; this tab only renders that file.
// This is the landing surface for the recurring work-analysis ritual.

export function AnalysisV3({
  onOpenProject,
  onSprint,
}: {
  onOpenProject: (projectId: string) => void;
  onSprint: (projectId: string) => void;
}) {
  const { state } = useStore();
  const { config } = useSync();
  const { rs, dispatchR } = useReinforcement();
  const [doc, setDoc] = useState<AnalysisDoc | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "offline">("loading");

  // The weekly review is a practice gate for leveling; this tab is the
  // ritual's landing surface, so logging it lives here. One per week.
  const thisWeek = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoDate(d);
  })();
  const reviewedThisWeek = effectiveEvents(rs.events).some((e) => {
    if (e.kind !== "review") return false;
    const d = new Date(e.at);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoDate(d) === thisWeek;
  });

  const refresh = useCallback(() => {
    if (!config) {
      setPhase("offline");
      return;
    }
    setPhase("loading");
    pullAnalysis(config)
      .then((d) => {
        setDoc(d);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, [config]);

  useEffect(refresh, [refresh]);

  const resolveProject = (f: AnalysisFinding): string | null => {
    if (!f.project) return null;
    const q = f.project.trim().toLowerCase();
    const hit =
      state.projects.find((p) => p.name.trim().toLowerCase() === q) ??
      state.projects.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
    return hit?.id ?? null;
  };

  const findings = doc?.findings ?? [];

  return (
    <div className="view3">
      <div className="cap">
        <b>Analysis — what the board sees</b>
        <span>
          {findings.length
            ? `${findings.length} finding${findings.length === 1 ? "" : "s"} · flags moved off the board`
            : "flags live here now, never on the board"}
        </span>
      </div>
      <div style={{ maxWidth: 760 }}>
        {phase === "offline" && (
          <div className="card3">
            <h4>Not connected</h4>
            <div style={{ fontSize: 12.5, color: "var(--lo)" }}>
              Connect sync (Backup / Sync) and the analysis file becomes readable here.
            </div>
          </div>
        )}
        {phase === "error" && (
          <div className="card3">
            <h4>Couldn't load the analysis file</h4>
            <div style={{ fontSize: 12.5, color: "var(--lo)" }}>
              <button className="btn" onClick={refresh}>
                Try again
              </button>
            </div>
          </div>
        )}
        {phase === "ready" && doc?.ifYouDoOneThing && (
          <div className="card3" style={{ borderColor: "rgba(255,255,255,.3)" }}>
            <h4>If you do one thing</h4>
            <div style={{ fontSize: 13.5, color: "var(--hi)" }}>{doc.ifYouDoOneThing}</div>
          </div>
        )}
        {phase === "ready" &&
          findings.map((f, i) => {
            const pid = resolveProject(f);
            return (
              <div key={i} className="card3">
                <h4>
                  {f.k && (
                    <span className="flag" style={{ marginRight: 6 }}>
                      {f.k}
                    </span>
                  )}
                  {f.t}
                </h4>
                {f.e && <div style={{ fontSize: 12, color: "var(--mid)" }}>{f.e}</div>}
                {f.w && <div style={{ fontSize: 11.5, color: "var(--lo)", margin: "5px 0 9px" }}>{f.w}</div>}
                {pid && (
                  <>
                    <button className="btn" onClick={() => onOpenProject(pid)}>
                      Open project
                    </button>
                    {f.sprint && (
                      <>
                        {" "}
                        <button className="btn pri" onClick={() => onSprint(pid)}>
                          ▶ Sprint on it
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        {phase === "ready" && findings.length === 0 && (
          <div className="card3">
            <h4>No findings yet</h4>
            <div style={{ fontSize: 12.5, color: "var(--lo)", lineHeight: 1.6 }}>
              Ask Claude in chat to run a work analysis — it reviews the board and stream history and writes its
              findings here.
            </div>
          </div>
        )}
        <div className="card3">
          <h4>Weekly review</h4>
          <div style={{ fontSize: 12.5, color: "var(--lo)", lineHeight: 1.6 }}>
            {reviewedThisWeek
              ? "Logged for this week — it counts toward your next rank."
              : "Read the findings, adjust the board, then log it — one review per level is part of ranking up."}
            {"  "}
            <button
              className="btn"
              style={{ marginLeft: 6 }}
              disabled={reviewedThisWeek}
              onClick={() => dispatchR({ type: "review" })}
            >
              {reviewedThisWeek ? "✓ Reviewed" : "Log weekly review"}
            </button>
          </div>
        </div>
        <div className="card3" style={{ borderStyle: "dashed" }}>
          <h4>How this works</h4>
          <div style={{ fontSize: 12, color: "var(--lo)", lineHeight: 1.6 }}>
            Claude reads your board and stream history from the gist — what cleared, what sat, timestamps — writes the
            findings to <b>viz-org-analysis.json</b>, and this tab renders them. Findings refresh on each review; flags
            live here now, never on the board.{" "}
            <button className="btn" style={{ marginLeft: 4 }} onClick={refresh}>
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
