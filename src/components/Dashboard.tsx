import {
  BADGES,
  POINTS_PER_CREDIT,
  availableCredits,
  level,
  pointsBreakdown,
  pointsToNextCredit,
  withGame,
} from "../game";
import { formatDuration, useStore } from "../store";

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Dashboard() {
  const { state, dispatch } = useStore();
  const game = withGame(state.game);
  const now = Date.now();

  const credits = availableCredits(game);
  const pct = Math.round(((POINTS_PER_CREDIT - pointsToNextCredit(game)) / POINTS_PER_CREDIT) * 100);
  const breakdown = pointsBreakdown(game);
  const breakdownTotal = breakdown.reduce((s, b) => s + b.points, 0) || 1;
  const ledger = game.ledger ?? [];

  const stat = (label: string, value: string | number, sub?: string) => (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {sub && <span className="stat__sub muted">{sub}</span>}
    </div>
  );

  return (
    <div className="dash">
      <div className="card">
        <div className="card__header">
          <h2>Progress</h2>
          <span className="muted">Lvl {level(game.points)}</span>
        </div>
        <div className="stat-grid">
          {stat("points", game.points, "lifetime")}
          {stat("today", game.pointsToday, "best " + game.bestDayPoints)}
          {stat("streak", `${game.streak}🔥`, "days active")}
          {stat("done", game.tasksCompleted, formatDuration(game.minutesCompleted ?? 0) + " of work")}
          {stat("combo", `${game.comboBest ?? 0}×`, "best run")}
          {stat("badges", `${game.badges.length}/${BADGES.length}`)}
        </div>
      </div>

      {/* Build Bank — the Premack reward. */}
      <div className="card credit-card">
        <div className="card__header">
          <h2>Build Bank</h2>
          <span className="muted">{POINTS_PER_CREDIT} pts = 1 build session</span>
        </div>
        <div className="credit-bar">
          <div className="credit-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="credit-row">
          <span className="muted">{pointsToNextCredit(game)} pts to next credit</span>
          <span className="credits-have">{credits} ready</span>
          <button className="btn btn-sm btn-primary" disabled={credits < 1} onClick={() => dispatch({ type: "redeemCredit" })}>
            Redeem a build session
          </button>
        </div>
      </div>

      {/* Where the points came from. */}
      <div className="card">
        <div className="card__header">
          <h2>Where points came from</h2>
        </div>
        {breakdown.length === 0 ? (
          <p className="muted empty-hint">Finish a task to start the chart.</p>
        ) : (
          <>
            <div className="bd-bar">
              {breakdown.map((b) => (
                <div
                  key={b.label}
                  className="bd-bar__seg"
                  style={{ width: `${(b.points / breakdownTotal) * 100}%`, background: b.color }}
                  title={`${b.label}: ${b.points}`}
                />
              ))}
            </div>
            <div className="bd-legend">
              {breakdown.map((b) => (
                <span key={b.label} className="bd-legend__item">
                  <span className="bd-dot" style={{ background: b.color }} />
                  {b.label} · <strong>{b.points}</strong>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Surprises — hinted, not spelled out. */}
      <div className="card surprises">
        <div className="card__header">
          <h2>Surprises</h2>
          <span className="muted">some reinforcement shows up unannounced…</span>
        </div>
        <ul className="surprise-hints">
          <li>🍀 Now and then a finished task pays out <em>extra</em>. You can't predict which — just keep clearing them.</li>
          <li>🎰 Finish a few <em>back to back</em> and something starts building. The faster you stack them, the better.</li>
          <li>🌙 Odd hours, overdue dragons, and eating the frog first all hide their own little rewards.</li>
          <li>❓ {game.badges.length} of {BADGES.length} badges found — a few only appear the moment you earn them.</li>
        </ul>
      </div>

      {/* Badges. */}
      <div className="card">
        <div className="card__header">
          <h2>Badges</h2>
          <span className="muted">{game.badges.length}/{BADGES.length}</span>
        </div>
        <div className="badge-grid">
          {BADGES.map((b) => {
            const earned = game.badges.includes(b.id);
            if (b.secret && !earned) {
              return (
                <div key={b.id} className="badge locked secret" title="Hidden — keep going to find it">
                  <span className="badge__emoji">❓</span>
                  <span className="badge__label">Secret</span>
                </div>
              );
            }
            return (
              <div key={b.id} className={`badge ${earned ? "earned" : "locked"}`} title={b.hint}>
                <span className="badge__emoji">{b.emoji}</span>
                <span className="badge__label">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* The ledger: every finished task and what it paid. */}
      <div className="card">
        <div className="card__header">
          <h2>Completed work</h2>
          <span className="muted">{game.tasksCompleted} all-time</span>
        </div>
        {ledger.length === 0 ? (
          <p className="muted empty-hint">Nothing logged yet — check a task off and it lands here.</p>
        ) : (
          <ul className="ledger">
            {ledger.map((e, i) => (
              <li key={`${e.id}-${i}`} className="ledger-row">
                <span className="ledger-row__title">{e.title}</span>
                <span className="ledger-row__bonuses">
                  {e.combo > 0 && <span className="pill pill-combo" title="combo bonus">🎰 +{e.combo}</span>}
                  {e.lucky > 0 && <span className="pill pill-lucky" title="lucky drop">🍀 +{e.lucky}</span>}
                </span>
                <span className="ledger-row__pts">+{e.points}</span>
                <span className="ledger-row__when muted">{timeAgo(e.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
