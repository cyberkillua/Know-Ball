import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { Shot } from "../lib/types";
import PitchShotMap from "./charts/PitchShotMap";
import GoalMouthMap from "./charts/GoalMouthMap";

// ── Derived metric helpers ────────────────────────────────────────────────────

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

function avg(vals: number[]) {
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Foot preference label
function footLabel(rightPct: number, leftPct: number): string {
  const dom = rightPct >= leftPct ? rightPct : leftPct;
  const name = rightPct >= leftPct ? "right" : "left";
  if (dom >= 80) return `Strongly ${name}-footed`;
  if (dom >= 60) return `Prefers ${name} foot`;
  return "Two-footed";
}

// Situation mapping
function mapSituation(sit: string): string {
  if (sit === "regular" || sit === "assisted") return "Open Play";
  if (sit === "fast-break") return "Counter Attack";
  if (["corner", "set-piece", "throw-in-set-piece", "free-kick"].includes(sit))
    return "Set Piece";
  if (sit === "penalty") return "Penalty";
  return "Open Play";
}

// Minute → phase
function minutePhase(minute: number): string {
  if (minute <= 15) return "0-15";
  if (minute <= 30) return "16-30";
  if (minute <= 45) return "31-45";
  if (minute <= 60) return "46-60";
  if (minute <= 75) return "61-75";
  return "76-90+";
}

const PHASES = ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90+"];

const SITUATION_COLORS: Record<string, string> = {
  "Open Play": "#3b82f6",
  "Counter Attack": "#f97316",
  "Set Piece": "#a855f7",
  Penalty: "#22c55e",
};

const BODY_PART_COLORS: Record<string, string> = {
  "right-foot": "#3b82f6",
  "left-foot": "#f97316",
  head: "#a855f7",
  other: "#6b7280",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KeyStatsRow({
  shots,
  xgotDelta,
  xgOverperformance,
}: {
  shots: Shot[];
  xgotDelta: number | null;
  xgOverperformance?: number | null;
}) {
  const total = shots.length;
  const goals = shots.filter((s) => s.result === "Goal").length;
  const conversion = total > 0 ? (goals / total) * 100 : null;
  const npShots = shots.filter((s) => s.situation !== "penalty");
  const avgNpXg = npShots.length > 0 ? avg(npShots.map((s) => Number(s.xg))) : null;
  const npGoals = npShots.filter((s) => s.result === "Goal").length;
  const npXgTotal = npShots.reduce((s, sh) => s + Number(sh.xg), 0);
  const npGvNpXg = npShots.length > 0 ? npGoals - npXgTotal : null;

  const xgotLabel =
    xgotDelta == null
      ? null
      : xgotDelta >= 0.05
        ? "Adds quality"
        : xgotDelta <= -0.05
          ? "Reduces quality"
          : "Neutral";

  const xgOverVal =
    xgOverperformance != null ? Number(xgOverperformance) : null;

  const cards = [
    { label: "Total shots", value: String(total), sub: null, color: null },
    { label: "Goals", value: String(goals), sub: null, color: null },
    {
      label: "Conversion",
      value: conversion != null ? `${conversion.toFixed(1)}%` : "—",
      sub: null,
      color:
        conversion != null
          ? conversion >= 15
            ? "#22c55e"
            : conversion >= 10
              ? "#f59e0b"
              : "#ef4444"
          : null,
    },
    {
      label: "avg np xG/shot",
      value: avgNpXg != null ? avgNpXg.toFixed(2) : "—",
      sub:
        avgNpXg != null
          ? avgNpXg >= 0.12
            ? "Good positions"
            : "Speculative"
          : null,
      color: null,
    },
    {
      label: "Shot technique impact",
      value:
        xgotDelta != null
          ? xgotDelta >= 0
            ? `+${xgotDelta.toFixed(2)}`
            : xgotDelta.toFixed(2)
          : "—",
      sub: xgotLabel,
      color:
        xgotDelta != null
          ? xgotDelta >= 0.05
            ? "#22c55e"
            : xgotDelta <= -0.05
              ? "#ef4444"
              : "#f59e0b"
          : null,
    },
    {
      label: "np G vs np xG",
      value:
        npGvNpXg != null
          ? npGvNpXg >= 0
            ? `+${npGvNpXg.toFixed(2)}`
            : npGvNpXg.toFixed(2)
          : "—",
      sub:
        npGvNpXg != null
          ? npGvNpXg > 0
            ? "Outperforming"
            : npGvNpXg < 0
              ? "Underperforming"
              : "On par"
          : null,
      color:
        npGvNpXg != null
          ? npGvNpXg > 0
            ? "#22c55e"
            : npGvNpXg < 0
              ? "#ef4444"
              : "#f59e0b"
          : null,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "var(--muted)",
            borderRadius: "var(--radius-md)",
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--muted-foreground)",
              marginBottom: 4,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: c.color ?? "var(--foreground)",
            }}
          >
            {c.value}
          </div>
          {c.sub && (
            <div
              style={{
                fontSize: 10,
                color: "var(--muted-foreground)",
                marginTop: 2,
              }}
            >
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FootPreference({ shots }: { shots: Shot[] }) {
  const byPart: Record<
    string,
    { shots: number; goals: number; xgs: number[] }
  > = {};

  for (const s of shots) {
    const part = s.body_part ?? "other";
    if (!byPart[part]) byPart[part] = { shots: 0, goals: 0, xgs: [] };
    byPart[part].shots++;
    if (s.result === "Goal") byPart[part].goals++;
    byPart[part].xgs.push(Number(s.xg));
  }

  const total = shots.length;
  const parts = ["right-foot", "left-foot", "head", "other"].filter(
    (p) => byPart[p],
  );

  const rightPct = total > 0 ? pct(byPart["right-foot"]?.shots ?? 0, total) : 0;
  const leftPct = total > 0 ? pct(byPart["left-foot"]?.shots ?? 0, total) : 0;
  const label = total > 0 ? footLabel(rightPct, leftPct) : null;

  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--foreground)",
            marginBottom: 10,
          }}
        >
          {label}
        </div>
      )}

      {/* Stacked bar */}
      <div
        style={{
          display: "flex",
          height: 20,
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        {["right-foot", "left-foot", "head", "other"].map((p) => {
          const share = total > 0 ? ((byPart[p]?.shots ?? 0) / total) * 100 : 0;
          if (share === 0) return null;
          return (
            <div
              key={p}
              title={`${p}: ${Math.round(share)}%`}
              style={{ width: `${share}%`, background: BODY_PART_COLORS[p] }}
            />
          );
        })}
      </div>

      {/* Stat cards per body part */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${parts.length}, minmax(0,1fr))`,
          gap: 6,
        }}
      >
        {parts.map((p) => {
          const d = byPart[p];
          const sharePct = pct(d.shots, total);
          const conv = d.shots > 0 ? pct(d.goals, d.shots) : 0;
          const label =
            p === "right-foot"
              ? "Right"
              : p === "left-foot"
                ? "Left"
                : p === "head"
                  ? "Head"
                  : "Other";
          return (
            <div
              key={p}
              style={{
                background: "var(--muted)",
                borderRadius: "var(--radius-md)",
                padding: "8px 10px",
                borderTop: `3px solid ${BODY_PART_COLORS[p]}`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--foreground)",
                  marginBottom: 6,
                }}
              >
                {label}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {d.shots} shots ({sharePct}%)
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {d.goals} goals
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {conv}% conv.
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {d.xgs.length > 0 ? avg(d.xgs).toFixed(3) : "—"} avg xG
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {["right-foot", "left-foot", "head", "other"].map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-sm"
              style={{ background: BODY_PART_COLORS[p] }}
            />
            <span>
              {p === "right-foot"
                ? "Right"
                : p === "left-foot"
                  ? "Left"
                  : p === "head"
                    ? "Head"
                    : "Other"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SituationBreakdown({ shots }: { shots: Shot[] }) {
  const grouped: Record<string, { shots: number; goals: number }> = {};

  for (const s of shots) {
    const grp = mapSituation(s.situation);
    if (!grouped[grp]) grouped[grp] = { shots: 0, goals: 0 };
    grouped[grp].shots++;
    if (s.result === "Goal") grouped[grp].goals++;
  }

  const data = Object.entries(grouped).map(([name, d]) => ({
    name,
    value: d.shots,
    goals: d.goals,
    conv: d.shots > 0 ? pct(d.goals, d.shots) : 0,
  }));

  const total = shots.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Donut */}
        <div style={{ flexShrink: 0 }}>
          <PieChart width={160} height={160}>
            <Pie
              data={data}
              cx={75}
              cy={75}
              innerRadius={45}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((d) => (
                <Cell
                  key={d.name}
                  fill={SITUATION_COLORS[d.name] ?? "#6b7280"}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11,
              }}
              formatter={(_val: any, _name: any, entry: any) => [
                `${entry.payload.value} shots · ${entry.payload.goals} goals · ${entry.payload.conv}% conv`,
                entry.payload.name,
              ]}
            />
          </PieChart>
          <div
            style={{
              textAlign: "center",
              marginTop: -8,
              fontSize: 11,
              color: "var(--muted-foreground)",
            }}
          >
            {total} total
          </div>
        </div>

        {/* Legend with stats */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
        >
          {data.map((d) => (
            <div
              key={d.name}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  flexShrink: 0,
                  background: SITUATION_COLORS[d.name] ?? "#6b7280",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: "var(--foreground)",
                  minWidth: 110,
                }}
              >
                {d.name}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {d.value} shots · {d.goals}G · {d.conv}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimingProfile({ shots }: { shots: Shot[] }) {
  const phaseMap: Record<string, { shots: number; goals: number }> = {};
  for (const p of PHASES) phaseMap[p] = { shots: 0, goals: 0 };

  for (const s of shots) {
    const phase = minutePhase(s.minute);
    phaseMap[phase].shots++;
    if (s.result === "Goal") phaseMap[phase].goals++;
  }

  const data = PHASES.map((p) => ({
    phase: p,
    goals: phaseMap[p].goals,
    other: phaseMap[p].shots - phaseMap[p].goals,
    total: phaseMap[p].shots,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        data={data}
        barSize={28}
        margin={{ top: 4, right: 4, left: -20, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="phase"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
          }}
          formatter={(val: any, name: any) => [
            val,
            name === "goals" ? "Goals" : "Shots",
          ]}
        />
        <Bar
          dataKey="other"
          stackId="a"
          fill="#3b82f6"
          fillOpacity={0.7}
          name="Shots"
          radius={[0, 0, 2, 2]}
        />
        <Bar
          dataKey="goals"
          stackId="a"
          fill="#22c55e"
          name="Goals"
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--muted-foreground)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Main ShotProfile component ────────────────────────────────────────────────

interface ShotProfileProps {
  shots: Shot[];
  xgotDelta: number | null;
  xgOverperformance?: number | null;
}

export default function ShotProfile({
  shots,
  xgotDelta,
  xgOverperformance,
}: ShotProfileProps) {
  if (shots.length === 0) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--muted-foreground)",
          fontSize: 14,
        }}
      >
        No shot data available for this season.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Pitch shot map */}
      <SubSection title="Shot zones">
        <PitchShotMap shots={shots} />
      </SubSection>

      {/* Key stats row */}
      <KeyStatsRow
        shots={shots}
        xgotDelta={xgotDelta}
        xgOverperformance={xgOverperformance}
      />

      {/* 2-column grid: goal mouth + foot preference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SubSection title="Goal mouth placement">
          <GoalMouthMap shots={shots} />
        </SubSection>
        <SubSection title="Foot preference">
          <FootPreference shots={shots} />
        </SubSection>
      </div>

      {/* 2-column grid: situation + timing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SubSection title="Situation breakdown">
          <SituationBreakdown shots={shots} />
        </SubSection>
        <SubSection title="Timing profile">
          <TimingProfile shots={shots} />
        </SubSection>
      </div>
    </div>
  );
}
