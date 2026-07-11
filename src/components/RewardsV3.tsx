import { formatDuration, sortTasksForDisplay, spotlightPick, taskMinutes, useStore } from "../store";
import { useStreams } from "../streams";
import {
  POINTS_PER_CREDIT,
  availableCredits3,
  creditsRedeemed,
  daysToGo,
  gateProgress,
  levelProgress,
  nextStepPay,
  paySplit,
  pointsAreOnlyGate,
  pointsToGo,
  pointsToNextCredit3,
  pointsTotal,
  recentEarnings,
  sprintedToday,
  taskWorth,
  useReinforcement,
  DOUBLER_PAY,
  SPRINT_PAY,
} from "../reinforcement";
import { GrowthStrip, PinStrip, ShieldGrid } from "./Heraldry";
import type { Task, Project } from "../types";

// The v3 Rewards tab under the ratified reinforcement layer: the slim rank
// card, the two recommendation boxes (Worth the most / Quick hits), the
// Build-Credits card (new engine is credit truth in v3 — deviation D5), a
// recent-earnings list from the event log, and the escutcheon badge case.
// Every line answers: how close am I, what is this worth, what do I still
// need — in ordinary words (spec §4; the strings are canonical).

interface Row {
  project: Project;
  task: Task;
}

export function RewardsV3({
  notify,
  onOpenTask,
  onSprint,
}: {
  notify: (msg: string) => void;
  onOpenTask: (projectId: string, taskId: string) => void;
  onSprint: (opts?: { projectId?: string; taskId?: string; preset?: number; queue?: string[] }) => void;
}) {
  const { state } = useStore();
  const { streams } = useStreams();
  const { rs, dispatchR } = useReinforcement();

  const total = pointsTotal(rs);
  const progress = levelProgress(rs);
  const toGo = pointsToGo(rs);
  const gates = gateProgress(rs);
  const pace = daysToGo(rs);
  const spot = spotlightPick(state);

  // -- rank card numbers ------------------------------------------------------
  const threshold = Math.max(1, rs.level.threshold);
  const carryPct = Math.min(100, (rs.level.carryIn / threshold) * 100);
  const earnPct = Math.max(0, Math.min(100 - carryPct, ((progress - rs.level.carryIn) / threshold) * 100));
  const gatesLeft: string[] = [];
  if (gates.sprints[0] < gates.sprints[1]) gatesLeft.push(`${gates.sprints[1] - gates.sprints[0]} more sprints`);
  if (gates.frogSprints[0] < gates.frogSprints[1])
    gatesLeft.push(`${gates.frogSprints[1] - gates.frogSprints[0]} more frog sprints`);
  if (gates.reviews[0] < gates.reviews[1]) gatesLeft.push("a weekly review");

  // -- Worth the most: top 4 open tasks by W, the Start-here pick pinned ------
  const open: Row[] = [];
  for (const project of state.projects) {
    for (const task of project.tasks) {
      if (!task.done && !task.held) open.push({ project, task });
    }
  }
  open.sort((a, b) => taskWorth(b.task) - taskWorth(a.task));
  let worthRows = open.slice(0, 4);
  if (spot && !worthRows.some((r) => r.task.id === spot.task.id)) {
    worthRows = [{ project: spot.project, task: spot.task }, ...worthRows.slice(0, 3)];
  }

  // -- Quick hits ---------------------------------------------------------------
  const doublerUnspent = !sprintedToday(rs);
  const quickTasks = open
    .filter((r) => taskMinutes(r.task) <= 30)
    .sort((a, b) => taskWorth(b.task) - taskWorth(a.task))
    .slice(0, 3);
  // The chain: every open ≤30m task, red first (urgent → high → due), up to 8.
  const chainIds = sortTasksForDisplay(open.filter((r) => taskMinutes(r.task) <= 30).map((r) => r.task))
    .slice(0, 8)
    .map((t) => t.id);
  const spotStream = spot ? streams.find((s) => s.taskId === spot.task.id) : undefined;
  const spotStepPay = spot && spotStream ? nextStepPay(spot.task, spotStream, rs.events) : 0;

  const redeem = () => {
    if (availableCredits3(rs) < 1) return;
    dispatchR({ type: "redeem" });
    notify("🧱 Build unlocked — go tinker. You earned it.");
  };

  const levelUpCue = (w: number) => w >= toGo && toGo > 0 && pointsAreOnlyGate(rs);

  return (
    <div className="view3">
      <div className="cap">
        <b>Rewards</b>
        <span>one loop: start a sprint → finish the task → bank credits → redeem a build → rank up</span>
      </div>
      <div className="rw">
        {/* --- top band: rank on the left, credits + earnings at the end --- */}
        <div className="rwtop">
          <div className="card3 rw-rank">
            <div className="rankhead">
              <span className="ranklbl">{rs.level.rank}</span>
              {rs.level.next && (
                <>
                  <span className="rankto">→</span>
                  <strong>{rs.level.next}</strong>
                </>
              )}
              <span className="rankpts">
                {Math.min(progress, threshold)} / {threshold} ⚡
              </span>
            </div>
            <div className="bigbar">
              <div className="bb-carry" style={{ width: `${carryPct}%` }} title={`${rs.level.carryIn} ⚡ rolled over`} />
              <div className="bb-earn" style={{ width: `${earnPct}%` }} />
            </div>
            <div className="barcap">
              <span>
                {rs.level.next === null
                  ? "Top of the ladder — it never decays."
                  : toGo > 0
                    ? `${toGo} ⚡ to go${pace ? ` — about ${pace} day${pace === 1 ? "" : "s"} at your pace` : ""}`
                    : gatesLeft.length
                      ? "Points done — the rest is practice"
                      : "Ready to level"}
              </span>
              {rs.level.carryIn > 0 && <span className="tiny3">{rs.level.carryIn} ⚡ rolled over</span>}
            </div>
            {rs.level.next && gatesLeft.length > 0 && (
              <div className="alsoline">
                Also needs{gatesLeft.map((g) => (
                  <span key={g}>
                    {" "}
                    · <b>{g}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="card3 rw-credits">
            <h4>🛠️ Build Credits</h4>
            <div className="cbar">
              <i style={{ width: `${total % POINTS_PER_CREDIT}%` }} />
            </div>
            <div className="credits-line">
              <b>{availableCredits3(rs)} ready</b> · {creditsRedeemed(rs)} redeemed
            </div>
            <div className="tiny3">{pointsToNextCredit3(rs)} pts to the next credit</div>
            <button className="btn pri" disabled={availableCredits3(rs) < 1} onClick={redeem}>
              Redeem → build session
            </button>
          </div>

          <div className="card3 rw-earn">
            <h4>
              Recent earnings <span className="h4-aside">⚡ {total} lifetime</span>
            </h4>
            <div className="ledg mini">
              {recentEarnings(rs, 5).map((e) => (
                <div key={e.id}>
                  <span className="lt">{e.label ?? e.kind}</span>
                  <span className="pt">{e.delta > 0 ? `+${e.delta} ⚡` : "—"}</span>
                </div>
              ))}
              {!recentEarnings(rs, 1).length && <div className="recsub">Nothing yet — finish something small.</div>}
            </div>
          </div>
        </div>

        {/* --- the two recommendation boxes --- */}
        <div className="rectwo">
          <div className="card3" style={{ margin: 0 }}>
            <h4>Worth the most</h4>
            <p className="recsub">the biggest earners — each pays step by step</p>
            {worthRows.map(({ project, task }) => {
              const stream = streams.find((s) => s.taskId === task.id);
              const sp = paySplit(task, stream);
              const w = taskWorth(task);
              const isSpot = spot?.task.id === task.id;
              return (
                <div key={task.id} className="trow" onClick={() => onOpenTask(project.id, task.id)}>
                  <span className="trow-t">
                    {isSpot ? "▶ " : ""}
                    {task.title}
                    <span className="tiny3">
                      {sp.n > 0
                        ? `${sp.n} steps · +${sp.perStep} each as you go · +${sp.closeReserve} when it closes`
                        : `pays +${w} when it closes`}
                    </span>
                  </span>
                  {isSpot && levelUpCue(w) && <span className="lvlup">levels you up</span>}
                  <span className="trow-v">+{w} ⚡</span>
                </div>
              );
            })}
            {!worthRows.length && <div className="recsub">Nothing open — enjoy it.</div>}
          </div>
          <div className="card3" style={{ margin: 0 }}>
            <h4>
              Quick hits
              {chainIds.length >= 2 && (
                <button
                  className="btn chainbtn"
                  title="One card at a time: work it, ✓ it, the next appears. Every completion pays on the spot."
                  onClick={() => onSprint({ queue: chainIds })}
                >
                  ⛓ Chain {chainIds.length}
                </button>
              )}
            </h4>
            <p className="recsub">a few points, fast</p>
            <div className="trow" onClick={() => onSprint({ preset: 10 })}>
              <span className="trow-t">
                Any 10-minute sprint
                <span className="tiny3">{doublerUnspent ? "first of the day pays double" : "starting counts"}</span>
              </span>
              <span className="trow-v">+{doublerUnspent ? SPRINT_PAY + DOUBLER_PAY : SPRINT_PAY} ⚡</span>
            </div>
            {quickTasks.map(({ project, task }) => (
              <div key={task.id} className="trow" onClick={() => onOpenTask(project.id, task.id)}>
                <span className="trow-t">
                  {task.title}
                  <span className="tiny3">{formatDuration(taskMinutes(task))}</span>
                </span>
                <span className="trow-v">+{taskWorth(task)} ⚡</span>
              </div>
            ))}
            {spot && spotStream && spotStepPay > 0 && (
              <div className="trow" onClick={() => onOpenTask(spot.project.id, spot.task.id)}>
                <span className="trow-t">
                  Check off one {spotStream.codename} step
                  <span className="tiny3">a few minutes</span>
                </span>
                <span className="trow-v">+{spotStepPay} ⚡</span>
              </div>
            )}
          </div>
        </div>

        {/* --- the badge case --- */}
        <div className="card3">
          <h4>Marks</h4>
          <p className="recsub">small wins, densely spaced — repeatable ones keep counting up</p>
          <PinStrip rs={rs} />
        </div>
        <div className="card3">
          <h4>Badges</h4>
          <p className="recsub">tap a badge to see what it takes — some level up as you go</p>
          <ShieldGrid rs={rs} />
          <GrowthStrip />
        </div>
      </div>
    </div>
  );
}
