import { useState } from "react";
import type { BadgeAward, REvent, ReinforcementState } from "../reinforcement";
import {
  asPlannedWeeks,
  creditsRedeemed,
  earlySprints,
  effectiveEvents,
  frogSprintsInAWeek,
  sprintWorkdayStreak,
  sprintsInADay,
} from "../reinforcement";

// The escutcheon badge case — ratified three-tier structure (spec §3):
//   Known    — visible criteria + progress.
//   Rumored  — silhouette + one cryptic clue.
//   Hidden   — evaluated silently elsewhere; criteria revealed only on earning.
// The registry is DATA, not code paths. The hidden pool is deliberately not
// enumerated here — its awards arrive through the gist file and render from
// their own embedded name/glyph. Badges never gate function; perks stay
// expressive only.
//
// Heraldic elaboration (ratified): the shield grows with the level. Ⅰ: one
// charge on a divided field. Ⅱ: two charges and/or a new division. Ⅲ: three
// charges two-and-one plus a chief or base band. No shield is ever a single
// flat color. Urgency-red and done-green stay OUT of the tincture set — the
// rank box remains the board's only high-saturation area.

// Tinctures (from the mockup).
const GOLD = "#e0ac33";
const GOLD2 = "#d4a53a";
const AZURE = "#2d5fb3";
const AZURE2 = "#1f4485";
const AZURE3 = "#274b7a";
const CYAN = "#0e8fb0";
const TEAL = "#16948c";
const PURPURE = "#6f56c9";
const MURREY = "#a3487c";
const STEEL = "#5f6d80";
const SIENNA = "#c96a2e";

export interface BadgeDef3 {
  id: string;
  name: string;
  glyph: string;
  kind: "known" | "rumored";
  /** Criteria in plain words (Known) — the tooltip body. */
  desc?: string;
  /** The one cryptic clue (Rumored). */
  clue?: string;
  /** Tier thresholds (levels Ⅰ/Ⅱ/Ⅲ) — mutually exclusive with repeatable. */
  tiers?: number[];
  repeatable?: boolean;
  /** CSS background per tier index (0-based); single-entry for untiered. */
  fields: string[];
  /** Charges (glyph repetitions) per tier index; 1 for untiered. */
  charges?: number[];
  /** Chief band (padding-top) per tier index. */
  chief?: boolean[];
  /** Progress metric — value toward the next tier/threshold; null = tracked
   * outside the app (criteria stay visible, progress unlisted). */
  metric?: (ctx: BadgeMetricCtx) => number;
  /** Human progress line for the tooltip. */
  progressText?: (value: number, award?: BadgeAward) => string;
}

export interface BadgeMetricCtx {
  rs: ReinforcementState;
  events: REvent[];
}

const split = (a: string, b: string, deg = 180) => `linear-gradient(${deg}deg, ${a} 0 50%, ${b} 50%)`;
const chiefed = (chief: string, a: string, b?: string) =>
  b
    ? `linear-gradient(180deg, ${chief} 0 24%, ${a} 24% 72%, ${b} 72%)`
    : `linear-gradient(180deg, ${chief} 0 26%, ${a} 26%)`;

export const BADGE_REGISTRY: BadgeDef3[] = [
  {
    id: "first_light",
    name: "First Light",
    glyph: "🌅",
    kind: "known",
    desc: "Log your first sprint.",
    fields: [chiefed(GOLD, AZURE)],
    chief: [true],
    metric: ({ events }) => effectiveEvents(events).filter((e) => e.kind === "sprint").length,
    progressText: (v) => (v >= 1 ? "" : "No sprints yet — any 10 minutes counts."),
  },
  {
    id: "early_bird",
    name: "Early Bird",
    glyph: "🌄",
    kind: "known",
    desc: "First sprint of the day before 9am, five times.",
    fields: [split(CYAN, AZURE)],
    metric: ({ events }) => earlySprints(events),
    progressText: (v) => (v >= 5 ? "" : `${v} of 5 early sprints so far`),
  },
  {
    id: "tidy_desk",
    name: "Tidy Desk",
    glyph: "🧹",
    kind: "known",
    repeatable: true,
    desc: "Clear Intake to zero for a full week.",
    fields: [split(TEAL, STEEL, 90)],
    progressText: (_v, award) => (award?.count ? `${award.count} week${award.count === 1 ? "" : "s"} so far` : ""),
  },
  {
    id: "frog_feast",
    name: "Frog Feast",
    glyph: "🐸",
    kind: "known",
    tiers: [1, 2, 3],
    desc: "Frog sprints in one week — the shield grows a frog at each level.",
    fields: [split(AZURE, AZURE3), split(AZURE, TEAL, 90), chiefed(GOLD, AZURE, AZURE2)],
    charges: [1, 2, 3],
    chief: [false, false, true],
    metric: ({ events }) => frogSprintsInAWeek(events),
    progressText: (v) => (v >= 3 ? "" : `best week so far: ${v} frog sprint${v === 1 ? "" : "s"}`),
  },
  {
    id: "momentum",
    name: "Momentum",
    glyph: "🌀",
    kind: "known",
    tiers: [5, 10, 20],
    desc: "Sprint on consecutive workdays — levels at 5, 10, 20.",
    fields: [split(PURPURE, MURREY, 135), split(PURPURE, MURREY, 90), chiefed(STEEL, PURPURE, MURREY)],
    charges: [1, 2, 3],
    chief: [false, false, true],
    metric: ({ events }) => sprintWorkdayStreak(events),
    progressText: (v) => `best streak: ${v} workday${v === 1 ? "" : "s"}`,
  },
  {
    id: "completionist",
    name: "Completionist",
    glyph: "🧩",
    kind: "known",
    desc: "Close a big task with every step checked.",
    fields: [chiefed(STEEL, GOLD2)],
    chief: [true],
  },
  {
    id: "builder",
    name: "Builder",
    glyph: "🔨",
    kind: "known",
    desc: "Redeem a Build Credit on a shipped installment.",
    fields: [split(SIENNA, STEEL, 135)],
    metric: ({ rs }) => creditsRedeemed(rs),
  },
  {
    id: "speed_run",
    name: "Speed Run",
    glyph: "🏃",
    kind: "known",
    tiers: [5, 25, 50],
    desc: "Finish a task within an hour of it landing — levels at 5, 25, 50.",
    fields: [split(CYAN, STEEL), split(CYAN, TEAL, 90), chiefed(GOLD, CYAN, AZURE2)],
    charges: [1, 2, 3],
    chief: [false, false, true],
  },
  {
    id: "marathon",
    name: "Marathon",
    glyph: "🏔️",
    kind: "known",
    desc: "Six sprints in a single day.",
    fields: [split(STEEL, AZURE2)],
    metric: ({ events }) => sprintsInADay(events),
    progressText: (v) => (v >= 6 ? "" : `best day so far: ${v} sprint${v === 1 ? "" : "s"}`),
  },
  {
    id: "second_wind",
    name: "Second Wind",
    glyph: "🌬️",
    kind: "known",
    desc: "Return to a task untouched for two weeks — and finish it.",
    fields: [split(CYAN, PURPURE, 135)],
  },
  {
    id: "old_guard",
    name: "Old Guard",
    glyph: "🗿",
    kind: "known",
    desc: "Clear the oldest task on the board.",
    fields: [split(STEEL, SIENNA)],
  },
  {
    id: "cold_open",
    name: "Cold Open",
    glyph: "❄️",
    kind: "known",
    desc: "Start a sprint within ten minutes of opening the app, five times.",
    fields: [split(CYAN, AZURE3, 135)],
  },
  {
    id: "as_planned",
    name: "As Planned",
    glyph: "🗓️",
    kind: "known",
    repeatable: true,
    desc: "A week where 70% of placed tasks finish on their day.",
    fields: [split(TEAL, AZURE, 90)],
    metric: ({ events }) => asPlannedWeeks(events),
  },
  {
    id: "full_provenance",
    name: "Full Provenance",
    glyph: "📜",
    kind: "known",
    desc: "Close a stream with every item resolved — done or dropped.",
    fields: [split(GOLD2, STEEL, 135)],
  },
  {
    id: "cartographer_badge",
    name: "Cartographer",
    glyph: "🧭",
    kind: "known",
    desc: "Arrives with the Analysis ritual.",
    fields: [split(AZURE, GOLD, 135)],
  },
  // --- rumored: silhouette + one cryptic clue, nothing else -------------------
  {
    id: "rumor_water",
    name: "— — —",
    glyph: "❔",
    kind: "rumored",
    clue: "“It waits at the water's edge.”",
    fields: [split("#22252a", "#22252a")],
  },
  {
    id: "rumor_coffee",
    name: "— — —",
    glyph: "❔",
    kind: "rumored",
    clue: "“Finished before the coffee cooled.”",
    fields: [split("#22252a", "#22252a")],
  },
  {
    id: "rumor_map",
    name: "— — —",
    glyph: "❔",
    kind: "rumored",
    clue: "“The map matched the territory.”",
    fields: [split("#22252a", "#22252a")],
  },
];

const ROMAN = ["", "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ"];

function Charges({ glyph, count, mini }: { glyph: string; count: number; mini?: boolean }) {
  if (count <= 1) return <span>{glyph}</span>;
  if (count === 2)
    return (
      <span className="charges2">
        <span>{glyph}</span>
        <span>{glyph}</span>
      </span>
    );
  return (
    <span className={`charges ${mini ? "mini-charges" : ""}`}>
      <span>{glyph}</span>
      <span>{glyph}</span>
      <span>{glyph}</span>
    </span>
  );
}

export function Shield({
  def,
  award,
  ctx,
  open,
  onToggle,
}: {
  def: BadgeDef3;
  award?: BadgeAward;
  ctx: BadgeMetricCtx;
  open: boolean;
  onToggle: () => void;
}) {
  const earned = !!award;
  const tier = award?.tier ?? 0;
  const fieldIdx = Math.max(0, Math.min((tier || 1) - 1, def.fields.length - 1));
  const field = def.fields[fieldIdx];
  const chargeCount = earned ? def.charges?.[fieldIdx] ?? 1 : 1;
  const withChief = earned && (def.chief?.[fieldIdx] ?? false);
  const state = def.kind === "rumored" ? "rumor" : earned ? "earned" : "dim";
  const metric = def.metric ? def.metric(ctx) : null;
  const progress = def.progressText && metric !== null ? def.progressText(metric, award) : null;

  return (
    <div
      className={`shieldtile ${state}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {earned && def.tiers && tier > 0 && <span className="roundel">{ROMAN[tier]}</span>}
      {earned && def.repeatable && (award?.count ?? 0) > 1 && <span className="roundel">×{award!.count}</span>}
      <div className="shrim">
        <div className={`shfld ${withChief ? "withchief" : ""}`} style={{ background: field }}>
          <Charges glyph={def.glyph} count={chargeCount} />
        </div>
      </div>
      <div className="shname">{def.name}</div>
      {open && (
        <div className="shtip" onClick={(e) => e.stopPropagation()}>
          <b>
            {def.name}
            {earned && def.tiers && tier > 0 ? ` · level ${ROMAN[tier]}` : ""}
            {earned && def.repeatable && (award?.count ?? 0) > 1 ? ` ×${award!.count}` : ""}
          </b>
          {def.kind === "rumored" ? (
            <i>{def.clue}</i>
          ) : (
            <>
              {def.desc}
              {earned && award && (
                <span className="shwhen">
                  {" "}
                  · {new Date(award.earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
              {!earned && progress ? <span className="shprog">{progress}</span> : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The full badge case: known + rumored from the registry, any gist-delivered
 * awards not in the registry (the hidden pool revealing itself), and the
 * "+N undiscovered" tile only when the pool size is actually known. */
export function ShieldGrid({ rs }: { rs: ReinforcementState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ctx: BadgeMetricCtx = { rs, events: rs.events };
  const registryIds = new Set(BADGE_REGISTRY.map((d) => d.id));
  const foreign = Object.entries(rs.badges).filter(([id]) => !registryIds.has(id));

  return (
    <div className="shieldgrid" onClick={() => setOpenId(null)}>
      {BADGE_REGISTRY.map((def) => (
        <Shield
          key={def.id}
          def={def}
          award={rs.badges[def.id]}
          ctx={ctx}
          open={openId === def.id}
          onToggle={() => setOpenId((v) => (v === def.id ? null : def.id))}
        />
      ))}
      {foreign.map(([id, award]) => (
        <Shield
          key={id}
          def={{
            id,
            name: award.name ?? "Revealed",
            glyph: award.glyph ?? "🏵️",
            kind: "known",
            desc: "From the hidden pool — you found out by earning it.",
            fields: [split(GOLD, PURPURE, 135)],
          }}
          award={award}
          ctx={ctx}
          open={openId === id}
          onToggle={() => setOpenId((v) => (v === id ? null : id))}
        />
      ))}
      {typeof rs.hiddenPool === "number" && rs.hiddenPool > 0 && (
        <div className="shieldtile">
          <div className="shplus">
            <b>+{rs.hiddenPool}</b>
            <span>undiscovered</span>
          </div>
          <div className="shname">&nbsp;</div>
        </div>
      )}
    </div>
  );
}

/** The "badges grow as they level" explainer strip (Frog Feast Ⅰ→Ⅱ→Ⅲ). */
export function GrowthStrip() {
  const frog = BADGE_REGISTRY.find((d) => d.id === "frog_feast")!;
  return (
    <div className="growstrip">
      <span className="growlbl">Badges grow as they level</span>
      <div className="growrow">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {i > 0 && <span className="growarrow">→</span>}
            <span className="shrim mini">
              <span className={`shfld ${frog.chief?.[i] ? "withchief" : ""}`} style={{ background: frog.fields[i] }}>
                <Charges glyph="🐸" count={frog.charges?.[i] ?? 1} mini />
              </span>
            </span>
          </span>
        ))}
        <span className="growcap">one frog on a split field → two frogs, new division → three frogs, a chief added</span>
      </div>
    </div>
  );
}
