import { useStore } from "../store";
import {
  BADGES,
  POINTS_PER_CREDIT,
  RANKS,
  availableCredits,
  pointsToNextCredit,
  rankIndex,
  withGame,
} from "../game";

// The v3 Rewards tab — one loop: start a sprint → finish the task → bank
// credits → redeem a build → rank up. Feedback is descriptive only — counts,
// firsts, trends. Ranks certify practice, never attendance; they never decay,
// and perks decorate, never gate.

function when(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days <= 0 && d.getDate() === now.getDate()) {
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (mins < 2) return "now";
    if (mins < 60) return `${mins}m ago`;
    return "today";
  }
  if (days <= 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="rwchip">
      {v}
      <span>{l}</span>
    </div>
  );
}

export function RewardsV3({ notify }: { notify: (msg: string) => void }) {
  const { state, dispatch } = useStore();
  const g = withGame(state.game);
  const have = availableCredits(g);
  const pct = g.points % POINTS_PER_CREDIT;
  const r = rankIndex(g);
  const rank = RANKS[r];
  const next = RANKS[r + 1];
  const earned = new Set(g.badges);

  const redeem = () => {
    if (have < 1) return;
    dispatch({ type: "redeemCredit" });
    notify("🧱 Build unlocked — go tinker. You earned it.");
  };

  return (
    <div className="view3">
      <div className="cap">
        <b>Rewards</b>
        <span>one loop: start a sprint → finish the task → bank credits → redeem a build → rank up</span>
      </div>
      <div className="rw">
        <div className="rwrow">
          <Stat v={`⚡ ${g.points}`} l="lifetime points" />
          <Stat v={`${g.tasksToday} closed`} l="today" />
          <Stat v={`🐸 ${g.heavyCompleted}`} l="frogs eaten" />
          <Stat v={`🎧 ${g.focusSessions}`} l="sprints finished" />
          <Stat v={`🎰 ×${g.comboBest ?? 0}`} l="best combo" />
          <Stat v={`${Math.round((g.minutesCompleted ?? 0) / 60)}h`} l="work completed" />
        </div>

        <div className="card3">
          <h4>🛠️ Build Credits — the right to keep building</h4>
          <div className="cbar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="crow">
            <span>{pointsToNextCredit(g)} pts to next credit</span>
            <span>
              {have} ready · {g.creditsRedeemed} redeemed
            </span>
            <button className="btn pri" disabled={have < 1} onClick={redeem}>
              Redeem → build session
            </button>
          </div>
        </div>

        <div className="card3">
          <h4>Rank — certifies practice, never attendance</h4>
          <div style={{ fontSize: 15, color: "var(--hi)", fontWeight: 700 }}>
            L{r + 1} · {rank.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--lo)", margin: "2px 0 8px" }}>
            certifies: {rank.motto}
            {rank.perk ? ` · unlocked: ${rank.perk}` : ""}
          </div>
          {next && (
            <>
              <div style={{ fontSize: 12.5, color: "var(--mid)" }}>
                Next — <b>{next.name}</b> <span style={{ color: "var(--lo)" }}>({next.motto})</span>
              </div>
              <ul className="req">
                {next.reqs.map((req) => {
                  const v = req.have(g);
                  const ok = v >= req.need;
                  return (
                    <li key={req.label} className={ok ? "ok" : "no"}>
                      {ok ? "✓" : "○"} {req.label} — {Math.min(v, req.need)}/{req.need}
                    </li>
                  );
                })}
              </ul>
              <div style={{ fontSize: 11, color: "var(--lo)", marginTop: 6 }}>
                perk on advance: {next.perk ?? "—"} · ranks never decay; perks decorate, never gate
              </div>
            </>
          )}
        </div>

        <div className="card3">
          <h4>Ledger — every point, and why</h4>
          <div className="ledg">
            {(g.ledger ?? []).slice(0, 14).map((e) => (
              <div key={e.id}>
                <span className="lt">{e.title}</span>
                <span className="tag">
                  {(e.tags ?? []).join(" · ")}
                  {e.tags?.length ? " · " : ""}
                  {when(e.at)}
                </span>
                <span className="pt">{e.points ? `+${e.points} ⚡` : "—"}</span>
              </div>
            ))}
            {!(g.ledger ?? []).length && (
              <div style={{ fontSize: 12.5, color: "var(--lo)" }}>Nothing yet — finish something small.</div>
            )}
          </div>
        </div>

        <div className="card3">
          <h4>
            Badges{" "}
            <span style={{ textTransform: "none", letterSpacing: 0 }}>
              · {earned.size} of {BADGES.length} found — a few only appear the moment you earn them
            </span>
          </h4>
          <div className="bgrid">
            {BADGES.map((b) => {
              const on = earned.has(b.id);
              const hidden = b.secret && !on;
              return (
                <span key={b.id} className="badge3" style={{ opacity: on ? 1 : 0.35 }}>
                  {hidden ? "❓" : b.emoji} {hidden ? "Secret" : b.label}
                  <span className="bh3">{hidden ? "keep going…" : b.hint}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
