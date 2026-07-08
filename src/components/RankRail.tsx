import { useEffect, useRef, useState } from "react";
import {
  LADDER,
  availableCredits3,
  levelProgress,
  pointsToGo,
  recentEarnings,
  useReinforcement,
} from "../reinforcement";

// The header rank rail (spec §4): rank name · thin segmented bar (rolled-over
// segment first) · "30 ⚡ to Frogkeeper". The popover carries the recent
// earnings, the rollover provenance, and the credits count (its only
// always-visible home moved here when the rail replaced the HUD chip).
// Tap toggles the popover (touch has no hover); Escape / outside-tap closes.

export function RankRail() {
  const { rs } = useReinforcement();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const threshold = Math.max(1, rs.level.threshold);
  const progress = levelProgress(rs);
  const toGo = pointsToGo(rs);
  const carryPct = Math.min(100, (rs.level.carryIn / threshold) * 100);
  const earnPct = Math.max(0, Math.min(100 - carryPct, ((progress - rs.level.carryIn) / threshold) * 100));
  const prevIdx = LADDER.indexOf(rs.level.rank) - 1;
  const prevRank = prevIdx >= 0 ? LADDER[prevIdx] : null;

  return (
    <div className="rankrail" ref={ref} onClick={() => setOpen((v) => !v)} title="Rank progress — tap for recent earnings">
      <span className="rr-rank">{rs.level.rank}</span>
      <div className="rr-bar">
        <div className="rr-carry" style={{ width: `${carryPct}%` }} />
        <div className="rr-earn" style={{ width: `${earnPct}%` }} />
      </div>
      <span className="rr-togo">
        {rs.level.next ? (toGo > 0 ? `${toGo} ⚡ to ${rs.level.next}` : `practice to ${rs.level.next}`) : "top of the ladder"}
      </span>
      {open && (
        <div className="rankpop" onClick={(e) => e.stopPropagation()}>
          <div className="rp-cap">Recent earnings</div>
          {recentEarnings(rs, 5).map((e) => (
            <div key={e.id} className="rp-row">
              <span>{e.label ?? e.kind}</span>
              <span>{e.delta > 0 ? `+${e.delta}` : "—"}</span>
            </div>
          ))}
          {!recentEarnings(rs, 1).length && <div className="rp-row"><span>Nothing yet</span><span>—</span></div>}
          {rs.level.carryIn > 0 && prevRank && (
            <>
              <div className="rp-cap">Rolled over from {prevRank}</div>
              <div className="rp-row">
                <span>Leftover points</span>
                <span>+{rs.level.carryIn}</span>
              </div>
            </>
          )}
          <div className="rp-cap">Build Credits</div>
          <div className="rp-row">
            <span>🛠️ ready to redeem</span>
            <span>{availableCredits3(rs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
