import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { domToPng } from "modern-screenshot";
import { ArrowLeft, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import RatingBadge from "../components/RatingBadge";
import MatchesTab from "../components/MatchesTab";
import SeasonTrendChart from "../components/charts/SeasonTrendChart";
import StatRow from "../components/StatRow";
import PizzaChart from "../components/charts/PizzaChart";
import { getPizzaMetrics } from "../lib/playerMetrics";
import {
  getPlayer,
  getPlayerSeasons,
  getPlayerRatings,
  getPlayerSeasonTrend,
  getPlayerPeerRating,
  getPlayerPeerMetricRanks,
  getSimilarRoleProfiles,
  getPlayerStats,
  getPlayerShots,
  getPlayerXgotDelta,
  getPlayerUnderstat,
} from "../lib/queries";
import {
  formatRoleArchetype,
  scoreConfidenceBand,
  scoreConfidenceDetail,
  scoreConfidenceLabel,
} from "../lib/utils";
import type {
  Player,
  MatchRating,
  PeerRating,
  PeerMetricRank,
  PlayerPeerRatingResponse,
  PlayerSeasonTrendPoint,
  PlayerStats,
  PlayerUnderstat,
  SimilarRoleProfile,
  Shot,
} from "../lib/types";
import ShotProfile from "../components/ShotProfile";
import RatingMethodNote from "../components/RatingMethodNote";
import RoleFitCard from "../components/RoleFitCard";
import ScoutReportCard, { type ScoutMetric } from "../components/ScoutReportCard";
import SocialScoutingReportCard, {
  type SocialMetric,
  type SocialScoutingReportCardProps,
} from "../components/SocialScoutingReportCard";

type PlayerTab = "overview" | "stats" | "scouting" | "matches";

export const Route = createFileRoute("/player/$id")({
  component: PlayerProfilePage,
});

const POSITION_LABELS: Record<string, string> = {
  ST: "Strikers",
  CF: "Centre-Forwards",
  LW: "Wingers",
  RW: "Wingers",
  LM: "Wingers",
  RM: "Wingers",
  WINGER: "Wingers",
  CAM: "Attacking Midfielders",
  CM: "Central Midfielders",
  CDM: "Central Midfielders",
  DM: "Central Midfielders",
  MID: "Central Midfielders",
  MIDFIELDER: "Central Midfielders",
  FB: "Fullbacks",
  LB: "Fullbacks",
  RB: "Fullbacks",
  LWB: "Fullbacks",
  RWB: "Fullbacks",
  CB: "Centre-Backs",
  DEF: "Defenders",
  GK: "Goalkeepers",
};

const PERCENTILE_MIN_MINUTES = 300;

// ── Stat helpers ──────────────────────────────────────────────────────────────
const fmt = (v: any, decimals = 2) => {
  if (v == null) return "—";
  const num = Number(v);
  if (isNaN(num)) return "—";
  return num.toFixed(decimals);
};
const fmtPct = (v: any) =>
  v != null ? `${Math.round(Number(v) * 100)}%` : "—";
const fmtSigned = (v: any) => {
  if (v == null) return "—";
  const n = Number(v);
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
};
const fmtModeValue = (
  mode: "per90" | "raw",
  per90: number | null | undefined,
  raw: number | null | undefined,
  decimals = 2,
) => (mode === "per90" ? fmt(per90, decimals) : raw == null ? "—" : fmt(raw, decimals));

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function avgPercentile(
  ...vals: (number | null | undefined)[]
): number | undefined {
  const valid = vals.filter((v) => v != null) as number[];
  if (valid.length === 0) return undefined;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

type PeerDimensionRow = {
  label: string;
  sublabel?: string;
  value: number | null | undefined;
  metricKey: string;
};

function percentileBand(value: number | null | undefined, roleLabel = "role") {
  if (value == null) return "No signal yet";
  if (value >= 90) return `Elite for ${roleLabel}`;
  if (value >= 75) return `Strong for ${roleLabel}`;
  if (value >= 55) return `Solid for ${roleLabel}`;
  if (value >= 35) return `Watch area`;
  return `Low signal`;
}

function confidenceCopy(confidence: number | null | undefined, ratedMinutes: number | null | undefined) {
  const mins = ratedMinutes ?? 0;
  if (confidence == null) return mins < 600 ? `Limited sample: ${mins} rated minutes` : null;
  if (confidence < 45) return `Limited sample: ${mins} rated minutes`;
  if (confidence < 70) return `Moderate sample: ${mins} rated minutes`;
  return `Trusted sample: ${mins} rated minutes`;
}

function scoreCopy(score: number | null | undefined, roleLabel: string | null) {
  if (score == null) return "Season-level performance score.";
  const role = roleLabel ? ` ${roleLabel}` : "";
  if (score >= 75) return `Excellent${role} season.`;
  if (score >= 62) return `Strong${role} season.`;
  if (score >= 48) return `Solid${role} season.`;
  return `Below standout${role} level so far.`;
}

function getPeerDimensionRows(
  pr: PeerRating,
  flags: { isWinger: boolean; isCAM: boolean; isCM: boolean; isDefender: boolean },
  preAssistPercentile: number | undefined,
): PeerDimensionRow[] {
  if (flags.isWinger) {
    return [
      { label: "Overall Season Value", sublabel: "Know Ball Score rank", value: pr.overall_percentile, metricKey: "overall_percentile" },
      { label: "1v1 Threat", sublabel: "productive dribbling", value: pr.productive_dribbling_percentile, metricKey: "productive_dribbling_percentile" },
      { label: "Chance Creation", sublabel: "xA, key passes, big chances", value: pr.chance_creation_percentile, metricKey: "chance_creation_percentile" },
      { label: "End Product", sublabel: "goals and assists contribution", value: pr.goal_contribution_percentile, metricKey: "goal_contribution_percentile" },
      { label: "Ball Carrying", sublabel: "dribbles, touches, retention", value: pr.carrying_percentile, metricKey: "carrying_percentile" },
      { label: "Shot Threat", sublabel: "shot generation", value: pr.shot_generation_percentile, metricKey: "shot_generation_percentile" },
      { label: "Defensive Work", sublabel: "recoveries and duels", value: pr.defensive_percentile, metricKey: "defensive_percentile" },
      { label: "Involvement", sublabel: "presence", value: pr.presence_percentile, metricKey: "presence_percentile" },
    ];
  }
  if (flags.isCAM) {
    return [
      { label: "Overall Season Value", sublabel: "Know Ball Score rank", value: pr.overall_percentile, metricKey: "overall_percentile" },
      { label: "Chance Creation", sublabel: "xA, key passes, big chances", value: pr.chance_creation_percentile, metricKey: "chance_creation_percentile" },
      { label: "Pre-Assists", sublabel: "pass before assist", value: preAssistPercentile, metricKey: "pass_to_assist_per90_percentile" },
      { label: "Goal Threat", sublabel: "shots, xG, goals", value: pr.goal_threat_percentile, metricKey: "goal_threat_percentile" },
      { label: "Connective Play", sublabel: "team function", value: pr.team_function_percentile, metricKey: "team_function_percentile" },
      { label: "Ball Carrying", sublabel: "progression and retention", value: pr.carrying_percentile, metricKey: "carrying_percentile" },
      { label: "Defensive Work", sublabel: "recoveries and pressure events", value: pr.defensive_percentile, metricKey: "defensive_percentile" },
    ];
  }
  if (flags.isCM) {
    return [
      { label: "Overall Season Value", sublabel: "Know Ball Score rank", value: pr.overall_percentile, metricKey: "overall_percentile" },
      { label: "Forward Passing Value", sublabel: "pass impact and progression", value: pr.volume_passing_percentile, metricKey: "volume_passing_percentile" },
      { label: "Control", sublabel: "pass security and low losses", value: pr.control_percentile, metricKey: "control_percentile" },
      { label: "Pre-Assists", sublabel: "pass before assist", value: preAssistPercentile, metricKey: "pass_to_assist_per90_percentile" },
      { label: "Ball Carrying", sublabel: "progressive carries", value: pr.carrying_percentile, metricKey: "carrying_percentile" },
      { label: "Chance Creation", sublabel: "xA, key passes, big chances", value: pr.chance_creation_percentile, metricKey: "chance_creation_percentile" },
      { label: "Defensive Coverage", sublabel: "recoveries, tackles, interceptions", value: pr.defensive_percentile, metricKey: "defensive_percentile" },
      { label: "Box Threat", sublabel: "shots, xG, goals", value: pr.goal_threat_percentile, metricKey: "goal_threat_percentile" },
    ];
  }
  if (flags.isDefender) {
    return [
      { label: "Overall Season Value", sublabel: "Know Ball Score rank", value: pr.overall_percentile, metricKey: "overall_percentile" },
      { label: "Box Defending", sublabel: "clearances, blocks, interceptions", value: pr.defensive_percentile, metricKey: "defensive_percentile" },
      { label: "Duels", sublabel: "aerial and ground contests", value: pr.duels_percentile, metricKey: "duels_percentile" },
      { label: "Composure", sublabel: "pass security and mistake control", value: pr.team_function_percentile, metricKey: "team_function_percentile" },
      { label: "Recovery & Carrying", sublabel: "mobility, recoveries, retention", value: pr.carrying_percentile, metricKey: "carrying_percentile" },
      { label: "Ball Playing", sublabel: "passing value and progression", value: pr.volume_passing_percentile, metricKey: "volume_passing_percentile" },
      { label: "Set-Piece Threat", sublabel: "shots and xG threat", value: pr.goal_threat_percentile, metricKey: "goal_threat_percentile" },
    ];
  }
  return [
    { label: "Overall Season Value", sublabel: "Know Ball Score rank", value: pr.overall_percentile, metricKey: "overall_percentile" },
    { label: "Finishing", sublabel: "goals versus chance quality", value: pr.finishing_percentile, metricKey: "finishing_percentile" },
    { label: "Shot Generation", sublabel: "shots and xG volume", value: pr.shot_generation_percentile, metricKey: "shot_generation_percentile" },
    { label: "Chance Creation", sublabel: "xA and key passes", value: pr.chance_creation_percentile, metricKey: "chance_creation_percentile" },
    { label: "Link Play", sublabel: "team function", value: pr.team_function_percentile, metricKey: "team_function_percentile" },
    { label: "Ball Carrying", sublabel: "dribbles and retention", value: pr.carrying_percentile, metricKey: "carrying_percentile" },
    { label: "Duels", sublabel: "aerial and ground contests", value: pr.duels_percentile, metricKey: "duels_percentile" },
    { label: "Defensive Work", sublabel: "pressing and recoveries", value: pr.defensive_percentile, metricKey: "defensive_percentile" },
    { label: "Clinicality", sublabel: "finishing versus xG", value: pr.xg_overperformance_percentile, metricKey: "xg_overperformance_percentile" },
  ];
}

function strongestSignals(rows: PeerDimensionRow[], takeWeak = false) {
  return rows
    .filter((row) => row.value != null && row.label !== "Overall Season Value")
    .sort((a, b) => takeWeak ? Number(a.value) - Number(b.value) : Number(b.value) - Number(a.value))
    .slice(0, 3);
}

function rankCopy(row: PeerDimensionRow, ranks: Record<string, PeerMetricRank>) {
  const rank = ranks[row.metricKey];
  if (!rank) return "—";
  return `${ordinal(rank.rank)} / ${rank.poolSize}`;
}

function sentenceList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function scoutingSummaryCopy(
  rows: PeerDimensionRow[],
  ranks: Record<string, PeerMetricRank>,
  roleLabel: string | null,
) {
  const rankedRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const strengths = rankedRows.filter((row) => Number(row.value) >= 70).slice(0, 3);
  const cautions = rankedRows.filter((row) => Number(row.value) < 40).slice(0, 3);
  const topRows = strengths.length > 0 ? strengths : rankedRows.slice(0, 2);
  const role = roleLabel ? roleLabel.toLowerCase() : "this role";

  const strengthText = topRows.length > 0
    ? `Strongest signals are ${sentenceList(topRows.map((row) => `${row.label} (${rankCopy(row, ranks)})`))}.`
    : "Not enough peer-ranked data yet to call out clear strengths.";

  const cautionText = cautions.length > 0
    ? `Watch ${sentenceList(cautions.map((row) => `${row.label} (${rankCopy(row, ranks)})`))}; those are the softer parts of the profile against this peer pool.`
    : "No major statistical red flag in the core dimensions.";

  const roleText = topRows.length > 0
    ? `Profiles best as ${role} with value led by ${sentenceList(topRows.slice(0, 2).map((row) => row.label.toLowerCase()))}.`
    : `Profiles as ${role}, but the sample needs more ranked signals before the fit is clear.`;

  return { strengthText, cautionText, roleText };
}

function rowByMetric(rows: PeerDimensionRow[], metricKey: string) {
  return rows.find((row) => row.metricKey === metricKey);
}

function rowRankText(row: PeerDimensionRow | undefined, ranks: Record<string, PeerMetricRank>) {
  if (!row) return "—";
  const rank = ranks[row.metricKey];
  if (!rank) return row.value == null ? "—" : `${Math.round(Number(row.value))}th pct`;
  return `${ordinal(rank.rank)} / ${rank.poolSize}`;
}

function percentileText(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(Number(value))}th pct`;
}

function socialMetricRows(
  rows: PeerDimensionRow[],
  ranks: Record<string, PeerMetricRank>,
): SocialMetric[] {
  return rows.map((row) => ({
    label: row.label,
    value: row.value,
    rank: rowRankText(row, ranks),
  }));
}

function cmScoutReport(
  rows: PeerDimensionRow[],
  ranks: Record<string, PeerMetricRank>,
  pr: PeerRating,
) {
  const signalRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const ordered = [...signalRows].sort((a, b) => Number(b.value) - Number(a.value));
  const top = ordered.slice(0, 3);

  const control = rowByMetric(rows, "control_percentile");
  const passing = rowByMetric(rows, "volume_passing_percentile");
  const carrying = rowByMetric(rows, "carrying_percentile");
  const creation = rowByMetric(rows, "chance_creation_percentile");
  const defending = rowByMetric(rows, "defensive_percentile");
  const boxThreat = rowByMetric(rows, "goal_threat_percentile");
  const preAssist = rowByMetric(rows, "pass_to_assist_per90_percentile");

  const topLabels = top.map((row) => row.label.toLowerCase());
  const headline = top.length > 0
    ? `Main value signals: ${sentenceList(topLabels)}.`
    : "Not enough CM value signals yet to form a clear read.";

  const concernItems: string[] = [];
  const usageItems: string[] = [];
  const notExpectItems: string[] = [];

  if (Number(control?.value ?? 50) >= 70) {
    usageItems.push("Use him to stabilize possession and keep midfield possessions alive.");
  }
  if (Number(passing?.value ?? 50) >= 70) {
    usageItems.push("Let him take responsibility for moving the ball forward by pass.");
  }
  if (Number(carrying?.value ?? 50) >= 70) {
    usageItems.push("Give him space to advance play by carrying through midfield.");
  }
  if (Number(defending?.value ?? 50) >= 70) {
    usageItems.push("He can cover ground defensively and support ball-winning phases.");
  }
  if (Number(creation?.value ?? 50) >= 70 || Number(preAssist?.value ?? 50) >= 70) {
    usageItems.push("He has enough creative signal to support final-third access.");
  }
  if (usageItems.length === 0 && top.length > 0) {
    usageItems.push(`Build the role around ${sentenceList(top.slice(0, 2).map((row) => row.label.toLowerCase()))}.`);
  }

  if (Number(control?.value ?? 100) < 40) {
    concernItems.push("Ball security is a real watch area for a central midfielder.");
  }
  if (Number(passing?.value ?? 100) < 40) {
    concernItems.push("Forward passing value is below the peer pool.");
  }
  if (Number(defending?.value ?? 100) < 40) {
    concernItems.push("Defensive coverage is light relative to other central midfielders.");
  }
  if (Number(carrying?.value ?? 100) < 40) {
    concernItems.push("Carrying progression is not a major part of the profile.");
  }
  if (Number(creation?.value ?? 100) < 40 && Number(preAssist?.value ?? 100) < 55) {
    concernItems.push("Direct chance creation is limited.");
  }

  if (Number(boxThreat?.value ?? 100) < 40) {
    notExpectItems.push("Do not project him primarily as a box-arriving scorer.");
  }
  if (Number(creation?.value ?? 100) < 40 && Number(preAssist?.value ?? 100) < 55) {
    notExpectItems.push("Do not make him the only final-ball creator.");
  }
  if (Number(defending?.value ?? 100) < 40) {
    notExpectItems.push("Do not leave him as the sole defensive screen.");
  }

  const evidenceRows = [control, passing, carrying, creation, defending, boxThreat, preAssist]
    .filter(Boolean) as PeerDimensionRow[];

  const seasonOnlyRows = [
    {
      label: "Pre-Assists",
      value: preAssist?.value,
      rank: rowRankText(preAssist, ranks),
    },
    {
      label: "xGChain",
      value: pr.xg_chain_per90_percentile,
      rank: pr.xg_chain_per90_percentile == null ? "—" : `${Math.round(Number(pr.xg_chain_per90_percentile))}th pct`,
    },
    {
      label: "xGBuildup",
      value: pr.xg_buildup_per90_percentile,
      rank: pr.xg_buildup_per90_percentile == null ? "—" : `${Math.round(Number(pr.xg_buildup_per90_percentile))}th pct`,
    },
    {
      label: "Final-third passes",
      value: pr.accurate_final_third_passes_per90_percentile,
      rank: pr.accurate_final_third_passes_per90_percentile == null ? "—" : `${Math.round(Number(pr.accurate_final_third_passes_per90_percentile))}th pct`,
    },
  ];

  return {
    headline,
    top,
    concernItems,
    usageItems,
    notExpectItems,
    evidenceRows,
    seasonOnlyRows,
  };
}

function stScoutReport(
  rows: PeerDimensionRow[],
  ranks: Record<string, PeerMetricRank>,
  pr: PeerRating,
) {
  const signalRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const ordered = [...signalRows].sort((a, b) => Number(b.value) - Number(a.value));
  const top = ordered.slice(0, 3);

  const finishing = rowByMetric(rows, "finishing_percentile");
  const shotGeneration = rowByMetric(rows, "shot_generation_percentile");
  const creation = rowByMetric(rows, "chance_creation_percentile");
  const linkPlay = rowByMetric(rows, "team_function_percentile");
  const carrying = rowByMetric(rows, "carrying_percentile");
  const duels = rowByMetric(rows, "duels_percentile");
  const defensive = rowByMetric(rows, "defensive_percentile");
  const clinicality = rowByMetric(rows, "xg_overperformance_percentile");

  const goalThreatScore = [
    pr.goals_per90_percentile,
    pr.np_goals_per90_percentile,
    pr.xg_per90_percentile,
    pr.np_xg_per90_percentile,
    pr.shots_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const shotQualityScore = [
    pr.xg_per_shot_percentile,
    pr.np_xg_per_shot_percentile,
    pr.shot_on_target_percentile,
    pr.xgot_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const topLabels = top.map((row) => row.label.toLowerCase());
  const headline = top.length > 0
    ? `Main value signals: ${sentenceList(topLabels)}.`
    : "Not enough striker value signals yet to form a clear read.";

  const concernItems: string[] = [];
  const usageItems: string[] = [];
  const notExpectItems: string[] = [];

  if (goalThreatScore >= 70 || Number(shotGeneration?.value ?? 50) >= 70) {
    usageItems.push("Use him as a primary box threat and shot-volume outlet.");
  }
  if (Number(finishing?.value ?? 50) >= 70 || Number(clinicality?.value ?? 50) >= 70) {
    usageItems.push("He adds value when chances fall to him inside scoring zones.");
  }
  if (Number(linkPlay?.value ?? 50) >= 70 || Number(creation?.value ?? 50) >= 70) {
    usageItems.push("He can connect attacks instead of only finishing them.");
  }
  if (Number(duels?.value ?? 50) >= 70) {
    usageItems.push("He can function as an outlet when the team needs direct access upfield.");
  }
  if (Number(carrying?.value ?? 50) >= 70) {
    usageItems.push("He can attack space by carrying or receiving into transition lanes.");
  }
  if (Number(defensive?.value ?? 50) >= 70) {
    usageItems.push("He gives useful front-line defensive work.");
  }
  if (usageItems.length === 0 && top.length > 0) {
    usageItems.push(`Build the striker role around ${sentenceList(top.slice(0, 2).map((row) => row.label.toLowerCase()))}.`);
  }

  if (Number(shotGeneration?.value ?? 100) < 40 || Number(pr.shots_per90_percentile ?? 100) < 40) {
    concernItems.push("Shot volume is a watch area for a striker.");
  }
  if (Number(pr.xg_per90_percentile ?? 100) < 40 && Number(pr.np_xg_per90_percentile ?? 100) < 40) {
    concernItems.push("Chance volume is below the striker peer pool.");
  }
  if (shotQualityScore < 40) {
    concernItems.push("Shot quality and execution indicators are soft.");
  }
  if (Number(linkPlay?.value ?? 100) < 40 && Number(duels?.value ?? 100) < 40) {
    concernItems.push("If he is not scoring, the outlet/link-play floor is limited.");
  }
  if (Number(pr.big_chances_missed_percentile ?? 100) < 40) {
    concernItems.push("Big-chance waste is a concern in the current sample.");
  }

  if (Number(creation?.value ?? 100) < 40) {
    notExpectItems.push("Do not project him as the main chance creator.");
  }
  if (Number(duels?.value ?? 100) < 40) {
    notExpectItems.push("Do not build the attack around him as a target/outlet striker.");
  }
  if (Number(defensive?.value ?? 100) < 40) {
    notExpectItems.push("Do not expect standout pressing or recovery value.");
  }

  const evidenceRows = [
    finishing,
    shotGeneration,
    clinicality,
    creation,
    linkPlay,
    carrying,
    duels,
    defensive,
  ].filter(Boolean) as PeerDimensionRow[];

  const seasonRows = [
    { label: "Goals", value: pr.goals_per90_percentile, rank: percentileText(pr.goals_per90_percentile) },
    { label: "np Goals", value: pr.np_goals_per90_percentile, rank: percentileText(pr.np_goals_per90_percentile) },
    { label: "xG", value: pr.xg_per90_percentile, rank: percentileText(pr.xg_per90_percentile) },
    { label: "np xG", value: pr.np_xg_per90_percentile, rank: percentileText(pr.np_xg_per90_percentile) },
    { label: "Shots", value: pr.shots_per90_percentile, rank: percentileText(pr.shots_per90_percentile) },
    { label: "xG / shot", value: pr.xg_per_shot_percentile, rank: percentileText(pr.xg_per_shot_percentile) },
    { label: "xGOT", value: pr.xgot_per90_percentile, rank: percentileText(pr.xgot_per90_percentile) },
    { label: "Big chances missed", value: pr.big_chances_missed_percentile, rank: percentileText(pr.big_chances_missed_percentile) },
  ];

  return {
    headline,
    top,
    concernItems,
    usageItems,
    notExpectItems,
    evidenceRows,
    seasonRows,
  };
}

function wingerScoutReport(
  rows: PeerDimensionRow[],
  pr: PeerRating,
) {
  const signalRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const ordered = [...signalRows].sort((a, b) => Number(b.value) - Number(a.value));
  const top = ordered.slice(0, 3);

  const oneVOne = rowByMetric(rows, "productive_dribbling_percentile");
  const creation = rowByMetric(rows, "chance_creation_percentile");
  const endProduct = rowByMetric(rows, "goal_contribution_percentile");
  const carrying = rowByMetric(rows, "carrying_percentile");
  const shotThreat = rowByMetric(rows, "shot_generation_percentile");
  const defensive = rowByMetric(rows, "defensive_percentile");
  const involvement = rowByMetric(rows, "presence_percentile");

  const crossingScore = [
    pr.accurate_cross_per90_percentile,
    pr.key_passes_per90_percentile,
    pr.big_chances_created_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const outputScore = [
    pr.goals_per90_percentile,
    pr.assists_per90_percentile,
    pr.xg_per90_percentile,
    pr.xa_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const topLabels = top.map((row) => row.label.toLowerCase());
  const headline = top.length > 0
    ? `Main value signals: ${sentenceList(topLabels)}.`
    : "Not enough winger value signals yet to form a clear read.";

  const concernItems: string[] = [];
  const usageItems: string[] = [];
  const notExpectItems: string[] = [];

  if (Number(oneVOne?.value ?? 50) >= 70 || Number(carrying?.value ?? 50) >= 70) {
    usageItems.push("Use him in isolation and transition lanes where he can attack defenders.");
  }
  if (Number(creation?.value ?? 50) >= 70 || crossingScore >= 70) {
    usageItems.push("He can be a service winger through crosses, cutbacks, and final-third passes.");
  }
  if (Number(endProduct?.value ?? 50) >= 70 || Number(shotThreat?.value ?? 50) >= 70 || outputScore >= 70) {
    usageItems.push("He has enough output signal to project as an inside-forward threat.");
  }
  if (Number(defensive?.value ?? 50) >= 70) {
    usageItems.push("He gives useful two-way work without the ball.");
  }
  if (Number(involvement?.value ?? 50) >= 70) {
    usageItems.push("He can stay involved across phases rather than only appearing in final actions.");
  }
  if (usageItems.length === 0 && top.length > 0) {
    usageItems.push(`Build the wide role around ${sentenceList(top.slice(0, 2).map((row) => row.label.toLowerCase()))}.`);
  }

  if (Number(oneVOne?.value ?? 100) < 40 && Number(carrying?.value ?? 100) < 40) {
    concernItems.push("1v1 and carrying threat are not strong winger signals in this sample.");
  }
  if (Number(creation?.value ?? 100) < 40 && crossingScore < 45) {
    concernItems.push("Chance creation and service value are light relative to wide peers.");
  }
  if (Number(endProduct?.value ?? 100) < 40 && Number(shotThreat?.value ?? 100) < 40) {
    concernItems.push("End-product and shot threat are below the winger peer pool.");
  }
  if (Number(defensive?.value ?? 100) < 40) {
    concernItems.push("Defensive contribution is a watch area for a two-way wide role.");
  }
  if (Number(involvement?.value ?? 100) < 40) {
    concernItems.push("Overall involvement is low, so impact may come in bursts.");
  }

  if (Number(creation?.value ?? 100) < 40) {
    notExpectItems.push("Do not project him as the main final-ball creator.");
  }
  if (Number(endProduct?.value ?? 100) < 40 && Number(shotThreat?.value ?? 100) < 40) {
    notExpectItems.push("Do not build the attack around him as a primary scorer yet.");
  }
  if (Number(oneVOne?.value ?? 100) < 40) {
    notExpectItems.push("Do not rely on him as the sole isolation outlet.");
  }

  const evidenceRows = [
    oneVOne,
    creation,
    endProduct,
    carrying,
    shotThreat,
    defensive,
    involvement,
  ].filter(Boolean) as PeerDimensionRow[];

  const seasonRows = [
    { label: "Goals", value: pr.goals_per90_percentile, rank: percentileText(pr.goals_per90_percentile) },
    { label: "Assists", value: pr.assists_per90_percentile, rank: percentileText(pr.assists_per90_percentile) },
    { label: "xG", value: pr.xg_per90_percentile, rank: percentileText(pr.xg_per90_percentile) },
    { label: "xA", value: pr.xa_per90_percentile, rank: percentileText(pr.xa_per90_percentile) },
    { label: "Shots", value: pr.shots_per90_percentile, rank: percentileText(pr.shots_per90_percentile) },
    { label: "Key Passes", value: pr.key_passes_per90_percentile, rank: percentileText(pr.key_passes_per90_percentile) },
    { label: "Big Chances Created", value: pr.big_chances_created_percentile, rank: percentileText(pr.big_chances_created_percentile) },
    { label: "Accurate Crosses", value: pr.accurate_cross_per90_percentile, rank: percentileText(pr.accurate_cross_per90_percentile) },
    { label: "Dribbles", value: pr.dribbles_per90_percentile, rank: percentileText(pr.dribbles_per90_percentile) },
    { label: "xGOT", value: pr.xgot_per90_percentile, rank: percentileText(pr.xgot_per90_percentile) },
  ];

  return {
    headline,
    top,
    concernItems,
    usageItems,
    notExpectItems,
    evidenceRows,
    seasonRows,
  };
}

function camScoutReport(
  rows: PeerDimensionRow[],
  ranks: Record<string, PeerMetricRank>,
  pr: PeerRating,
) {
  const signalRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const ordered = [...signalRows].sort((a, b) => Number(b.value) - Number(a.value));
  const top = ordered.slice(0, 3);

  const creation = rowByMetric(rows, "chance_creation_percentile");
  const preAssist = rowByMetric(rows, "pass_to_assist_per90_percentile");
  const goalThreat = rowByMetric(rows, "goal_threat_percentile");
  const connective = rowByMetric(rows, "team_function_percentile");
  const carrying = rowByMetric(rows, "carrying_percentile");
  const defensive = rowByMetric(rows, "defensive_percentile");

  const finalBallScore = [
    creation?.value,
    preAssist?.value,
    pr.xa_per90_percentile,
    pr.key_passes_per90_percentile,
    pr.big_chances_created_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const boxThreatScore = [
    goalThreat?.value,
    pr.goals_per90_percentile,
    pr.xg_per90_percentile,
    pr.shots_per90_percentile,
    pr.xgot_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const linkScore = [
    connective?.value,
    pr.xg_chain_per90_percentile,
    pr.xg_buildup_per90_percentile,
    pr.accurate_final_third_passes_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const topLabels = top.map((row) => row.label.toLowerCase());
  const headline = top.length > 0
    ? `Main value signals: ${sentenceList(topLabels)}.`
    : "Not enough AM value signals yet to form a clear read.";

  const concernItems: string[] = [];
  const usageItems: string[] = [];
  const notExpectItems: string[] = [];

  if (finalBallScore >= 70 || Number(creation?.value ?? 50) >= 70 || Number(preAssist?.value ?? 50) >= 70) {
    usageItems.push("Use him as a final-ball connector between midfield and the forwards.");
  }
  if (boxThreatScore >= 70 || Number(goalThreat?.value ?? 50) >= 70) {
    usageItems.push("He can play close to the striker as a box-arriving or second-striker threat.");
  }
  if (linkScore >= 70 || Number(connective?.value ?? 50) >= 70) {
    usageItems.push("He can link phases and keep attacks connected through central zones.");
  }
  if (Number(carrying?.value ?? 50) >= 70) {
    usageItems.push("Give him room to receive between lines and carry at the back line.");
  }
  if (Number(defensive?.value ?? 50) >= 70) {
    usageItems.push("He can support a pressing 10 role without being a passenger out of possession.");
  }
  if (usageItems.length === 0 && top.length > 0) {
    usageItems.push(`Build the AM role around ${sentenceList(top.slice(0, 2).map((row) => row.label.toLowerCase()))}.`);
  }

  if (finalBallScore < 40 && Number(creation?.value ?? 100) < 40) {
    concernItems.push("Final-ball creation is below the attacking-midfield peer pool.");
  }
  if (boxThreatScore < 40 && Number(goalThreat?.value ?? 100) < 40) {
    concernItems.push("Goal threat is light for a high attacking-midfield role.");
  }
  if (linkScore < 40 && Number(connective?.value ?? 100) < 40) {
    concernItems.push("Connective play is not a major strength in this sample.");
  }
  if (Number(carrying?.value ?? 100) < 40) {
    concernItems.push("Ball carrying and line-breaking by dribble are limited.");
  }
  if (Number(defensive?.value ?? 100) < 40) {
    concernItems.push("Defensive work rate is a watch area for pressing-heavy usage.");
  }

  if (Number(creation?.value ?? 100) < 40 && Number(preAssist?.value ?? 100) < 45) {
    notExpectItems.push("Do not make him the only final-ball hub.");
  }
  if (Number(goalThreat?.value ?? 100) < 40) {
    notExpectItems.push("Do not project him primarily as a second striker.");
  }
  if (Number(connective?.value ?? 100) < 40) {
    notExpectItems.push("Do not rely on him as the main tempo/link player.");
  }

  const evidenceRows = [
    creation,
    preAssist,
    goalThreat,
    connective,
    carrying,
    defensive,
  ].filter(Boolean) as PeerDimensionRow[];

  const seasonRows = [
    { label: "Pre-Assists", value: preAssist?.value, rank: rowRankText(preAssist, ranks) },
    { label: "xA", value: pr.xa_per90_percentile, rank: percentileText(pr.xa_per90_percentile) },
    { label: "Assists", value: pr.assists_per90_percentile, rank: percentileText(pr.assists_per90_percentile) },
    { label: "Key Passes", value: pr.key_passes_per90_percentile, rank: percentileText(pr.key_passes_per90_percentile) },
    { label: "Big Chances Created", value: pr.big_chances_created_percentile, rank: percentileText(pr.big_chances_created_percentile) },
    { label: "Goals", value: pr.goals_per90_percentile, rank: percentileText(pr.goals_per90_percentile) },
    { label: "xG", value: pr.xg_per90_percentile, rank: percentileText(pr.xg_per90_percentile) },
    { label: "Shots", value: pr.shots_per90_percentile, rank: percentileText(pr.shots_per90_percentile) },
    { label: "xGOT", value: pr.xgot_per90_percentile, rank: percentileText(pr.xgot_per90_percentile) },
    { label: "xGChain", value: pr.xg_chain_per90_percentile, rank: percentileText(pr.xg_chain_per90_percentile) },
    { label: "xGBuildup", value: pr.xg_buildup_per90_percentile, rank: percentileText(pr.xg_buildup_per90_percentile) },
    { label: "Final-third passes", value: pr.accurate_final_third_passes_per90_percentile, rank: percentileText(pr.accurate_final_third_passes_per90_percentile) },
  ];

  return {
    headline,
    top,
    concernItems,
    usageItems,
    notExpectItems,
    evidenceRows,
    seasonRows,
  };
}

function defenderScoutReport(
  rows: PeerDimensionRow[],
  pr: PeerRating,
  stats: PlayerStats | null,
) {
  const signalRows = rows.filter((row) => row.label !== "Overall Season Value" && row.value != null);
  const ordered = [...signalRows].sort((a, b) => Number(b.value) - Number(a.value));
  const top = ordered.slice(0, 3);

  const boxDefending = rowByMetric(rows, "defensive_percentile");
  const duels = rowByMetric(rows, "duels_percentile");
  const composure = rowByMetric(rows, "team_function_percentile");
  const recovery = rowByMetric(rows, "carrying_percentile");
  const ballPlaying = rowByMetric(rows, "volume_passing_percentile");
  const setPieceThreat = rowByMetric(rows, "goal_threat_percentile");

  const duelScore = [
    duels?.value,
    pr.aerials_per90_percentile,
    pr.aerial_win_rate_percentile,
    pr.ground_duels_won_per90_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const ballPlayingScore = [
    ballPlaying?.value,
    pr.pass_value_normalized_percentile,
    pr.accurate_long_balls_per90_percentile,
    pr.long_ball_accuracy_percentile,
    pr.passing_accuracy_percentile,
  ].filter((value) => value != null).reduce((sum, value, _idx, arr) => sum + Number(value) / arr.length, 0);

  const riskEvents = (stats?.errors_led_to_goal ?? 0) + (stats?.errors_led_to_shot ?? 0);

  const topLabels = top.map((row) => row.label.toLowerCase());
  const headline = top.length > 0
    ? `Main value signals: ${sentenceList(topLabels)}.`
    : "Not enough defender value signals yet to form a clear read.";

  const concernItems: string[] = [];
  const usageItems: string[] = [];
  const notExpectItems: string[] = [];

  if (Number(boxDefending?.value ?? 50) >= 70) {
    usageItems.push("Use him as a penalty-box defender who can absorb direct pressure.");
  }
  if (duelScore >= 70 || Number(duels?.value ?? 50) >= 70) {
    usageItems.push("He can handle aerial and physical duel responsibility.");
  }
  if (ballPlayingScore >= 70 || Number(ballPlaying?.value ?? 50) >= 70) {
    usageItems.push("He can be trusted as a build-up outlet from the back line.");
  }
  if (Number(composure?.value ?? 50) >= 70) {
    usageItems.push("He profiles as a secure possession defender under pressure.");
  }
  if (Number(recovery?.value ?? 50) >= 70) {
    usageItems.push("He can cover space and recover actions outside the box.");
  }
  if (Number(setPieceThreat?.value ?? 50) >= 70) {
    usageItems.push("He adds useful set-piece threat in the opposition box.");
  }
  if (usageItems.length === 0 && top.length > 0) {
    usageItems.push(`Build the defensive role around ${sentenceList(top.slice(0, 2).map((row) => row.label.toLowerCase()))}.`);
  }

  if (Number(boxDefending?.value ?? 100) < 40) {
    concernItems.push("Observable box-defending output is light relative to defender peers.");
  }
  if (duelScore < 40 && Number(duels?.value ?? 100) < 40) {
    concernItems.push("Duel profile is a watch area, especially in isolated defensive matchups.");
  }
  if (ballPlayingScore < 40 && Number(ballPlaying?.value ?? 100) < 40) {
    concernItems.push("Ball-playing value is limited compared with this defender pool.");
  }
  if (Number(composure?.value ?? 100) < 40 || riskEvents > 0) {
    concernItems.push("Composure and mistake control need checking under pressure.");
  }
  if (Number(recovery?.value ?? 100) < 40) {
    concernItems.push("Recovery and mobility signals are not a major strength.");
  }

  if (Number(duels?.value ?? 100) < 40) {
    notExpectItems.push("Do not isolate him as the main aerial or physical stopper.");
  }
  if (Number(ballPlaying?.value ?? 100) < 40) {
    notExpectItems.push("Do not make him the main progression outlet in build-up.");
  }
  if (Number(composure?.value ?? 100) < 40) {
    notExpectItems.push("Do not overexpose him to high-pressure possession sequences.");
  }

  const evidenceRows = [
    boxDefending,
    duels,
    composure,
    recovery,
    ballPlaying,
    setPieceThreat,
  ].filter(Boolean) as PeerDimensionRow[];

  const seasonRows = [
    { label: "Tackles", value: pr.tackles_per90_percentile, rank: percentileText(pr.tackles_per90_percentile) },
    { label: "Interceptions", value: pr.interceptions_per90_percentile, rank: percentileText(pr.interceptions_per90_percentile) },
    { label: "Recoveries", value: pr.ball_recoveries_per90_percentile, rank: percentileText(pr.ball_recoveries_per90_percentile) },
    { label: "Aerials", value: pr.aerials_per90_percentile, rank: percentileText(pr.aerials_per90_percentile) },
    { label: "Aerial Win Rate", value: pr.aerial_win_rate_percentile, rank: percentileText(pr.aerial_win_rate_percentile) },
    { label: "Ground Duels", value: pr.ground_duels_won_per90_percentile, rank: percentileText(pr.ground_duels_won_per90_percentile) },
    { label: "Pass Value", value: pr.pass_value_normalized_percentile, rank: percentileText(pr.pass_value_normalized_percentile) },
    { label: "Pass Accuracy", value: pr.passing_accuracy_percentile, rank: percentileText(pr.passing_accuracy_percentile) },
    { label: "Long Balls", value: pr.accurate_long_balls_per90_percentile, rank: percentileText(pr.accurate_long_balls_per90_percentile) },
    { label: "Long Ball Acc.", value: pr.long_ball_accuracy_percentile, rank: percentileText(pr.long_ball_accuracy_percentile) },
    { label: "Set-Piece xG", value: pr.xg_per90_percentile, rank: percentileText(pr.xg_per90_percentile) },
    { label: "Errors to Shot/Goal", value: null, rank: `${stats?.errors_led_to_shot ?? 0}/${stats?.errors_led_to_goal ?? 0}` },
  ];

  return {
    headline,
    top,
    concernItems,
    usageItems,
    notExpectItems,
    evidenceRows,
    seasonRows,
  };
}

function methodVariantForPosition(position: string | null | undefined): React.ComponentProps<typeof RatingMethodNote>["variant"] {
  const pos = (position ?? "").toUpperCase();
  if (["CB", "FB", "LB", "RB", "LWB", "RWB", "DEF", "DEFENDER"].includes(pos)) return "defender";
  if (["CM", "CDM", "DM", "MID", "MIDFIELDER"].includes(pos)) return "midfielder";
  if (["CAM", "AM"].includes(pos)) return "attacking-midfielder";
  if (["LW", "RW", "LM", "RM", "W", "WINGER"].includes(pos)) return "winger";
  return "forward";
}

// Select percentile based on mode (per90 vs raw)
// Returns 0 if not qualified (under 300 mins) since percentiles require minimum playing time
function pct(
  per90Pct: number | null | undefined,
  rawPct: number | null | undefined,
  mode: "per90" | "raw",
  qualified: boolean,
): number | undefined {
  if (!qualified) return undefined;
  const value = mode === "raw" ? rawPct : per90Pct;
  return value ?? undefined;
}

// Interpolates between red→amber→green based on a 0–100 value and per-metric thresholds.
// low: value below which it's fully red. high: value above which it's fully green.
function bandTone(value: number | null | undefined): "good" | "warn" | "bad" | "muted" {
  if (value == null) return "muted";
  const v = Number(value);
  if (v >= 70) return "good";
  if (v >= 40) return "warn";
  return "bad";
}

function rateColor(val: number, low: number, high: number): string {
  const t = Math.max(0, Math.min(1, (val - low) / (high - low)));
  if (t < 0.5) {
    // red (#e24b4a) → amber (#ef9f27)
    const s = t / 0.5;
    const r = Math.round(226 + (239 - 226) * s);
    const g = Math.round(75 + (159 - 75) * s);
    const b = Math.round(74 + (39 - 74) * s);
    return `rgb(${r},${g},${b})`;
  } else {
    // amber (#ef9f27) → green (#1d9e75)
    const s = (t - 0.5) / 0.5;
    const r = Math.round(239 + (29 - 239) * s);
    const g = Math.round(159 + (158 - 159) * s);
    const b = Math.round(39 + (117 - 39) * s);
    return `rgb(${r},${g},${b})`;
  }
}

function PlayerProfilePage() {
  const { id } = Route.useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [seasons, setSeasons] = useState<
    {
      season: string;
      league_id: number;
      league_name: string;
      matches: number;
    }[]
  >([]);
  const [seasonTrend, setSeasonTrend] = useState<PlayerSeasonTrendPoint[]>([]);
  const [season, setSeason] = useState<string>("");
  const [ratings, setRatings] = useState<MatchRating[]>([]);
  const [peerRating, setPeerRating] = useState<PeerRating | null>(null);
  const [allPeerRating, setAllPeerRating] = useState<PeerRating | null>(null);
  const [peerMetricRanks, setPeerMetricRanks] = useState<Record<string, PeerMetricRank>>({});
  const [allPeerMetricRanks, setAllPeerMetricRanks] = useState<Record<string, PeerMetricRank>>({});
  const [similarRoleProfiles, setSimilarRoleProfiles] = useState<SimilarRoleProfile[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [xgotDelta, setXgotDelta] = useState<number | null>(null);
  const [understat, setUnderstat] = useState<PlayerUnderstat | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [peerScope, setPeerScope] = useState<"league" | "all">("league");
  const [statMode, setStatMode] = useState<"per90" | "raw">("per90");
  const [viewMode, setViewMode] = useState<"bars" | "pizza">("bars");
  const [activeTab, setActiveTab] = useState<PlayerTab>("overview");
  const percentileCardRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const scoutingSocialCardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [scoutDownloading, setScoutDownloading] = useState(false);
  const [scoutExportLayerVisible, setScoutExportLayerVisible] = useState(false);

  const handleDownloadPercentiles = async () => {
    if (!percentileCardRef.current || !player) return;
    setDownloading(true);

    const controls = controlsRef.current;
    if (controls) controls.style.visibility = "hidden";

    await new Promise((r) => setTimeout(r, 50));

    try {
      const dataUrl = await domToPng(percentileCardRef.current, {
        scale: 2,
        backgroundColor: "#0a0a0a",
      });

      const link = document.createElement("a");
      link.download = `${player.name.replace(/\s+/g, "_")}_percentiles_${statMode}_${viewMode}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      if (controls) controls.style.visibility = "";
      setDownloading(false);
    }
  };

  const handleExportScoutReport = async () => {
    if (!player) return;
    setScoutDownloading(true);
    setScoutExportLayerVisible(true);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await document.fonts?.ready;

    try {
      if (!scoutingSocialCardRef.current) return;
      const dataUrl = await domToPng(scoutingSocialCardRef.current, {
        scale: 1,
        backgroundColor: "#0a0a0a",
      });
      const seasonLabel = currentSeason?.season ?? season.split("|")[1] ?? "season";
      const filename = `${player.name.replace(/\s+/g, "_")}_scouting_report_${seasonLabel}.png`;
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], filename, { type: "image/png" });
      const shareData = {
        title: `${player.name} scouting report`,
        text: `${player.name} scouting report`,
        files: [file],
      };

      if (navigator.canShare?.(shareData) && navigator.share) {
        await navigator.share(shareData);
      } else {
        const link = document.createElement("a");
        link.download = filename;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") {
        console.error("Failed to export scouting report:", err);
      }
    } finally {
      setScoutExportLayerVisible(false);
      setScoutDownloading(false);
    }
  };

  // Load player info and available seasons
  useEffect(() => {
    let isCurrent = true;
    const playerId = Number(id);
    setSeason(""); // reset stale season from previous player before fetching
    setSeasonTrend([]);
    setLoading(true);
    Promise.all([
      getPlayer({ data: { playerId } }),
      getPlayerSeasons({ data: { playerId } }),
      getPlayerSeasonTrend({ data: { playerId } }),
    ]).then(([p, s, trend]) => {
      if (!isCurrent) return;
      setPlayer(p);
      setSeasons(s);
      setSeasonTrend(trend);
      if (s.length > 0) {
        const first = s[0];
        setSeason(`${first.league_id}|${first.season}`);
      } else {
        setLoading(false);
      }
    });
    return () => { isCurrent = false; };
  }, [id]);

  // Load season-specific data whenever the selected season changes
  useEffect(() => {
    if (!season) return;
    let isCurrent = true;
    const playerId = Number(id);
    const [leagueId, seasonStr] = season.split("|");
    const leagueIdNum = Number(leagueId);
    setSeasonLoading(true);
    setSimilarRoleProfiles([]);
    Promise.all([
      getPlayerRatings({
        data: { playerId, season: seasonStr, leagueId: leagueIdNum },
      }),
      getPlayerPeerRating({
        data: {
          playerId,
          season: seasonStr,
          leagueId: leagueIdNum,
          scope: "league",
        },
      }),
      getPlayerPeerRating({
        data: {
          playerId,
          season: seasonStr,
          leagueId: leagueIdNum,
          scope: "all",
        },
      }),
      getPlayerPeerMetricRanks({
        data: {
          playerId,
          season: seasonStr,
          leagueId: leagueIdNum,
          scope: "league",
        },
      }),
      getPlayerPeerMetricRanks({
        data: {
          playerId,
          season: seasonStr,
          leagueId: leagueIdNum,
          scope: "all",
        },
      }),
      getPlayerStats({
        data: { playerId, season: seasonStr, leagueId: leagueIdNum },
      }),
      getPlayerShots({
        data: { playerId, season: seasonStr, leagueId: leagueIdNum },
      }),
      getPlayerXgotDelta({
        data: { playerId, season: seasonStr, leagueId: leagueIdNum },
      }),
      getPlayerUnderstat({ data: { playerId, season: seasonStr } }),
      getSimilarRoleProfiles({
        data: { playerId, season: seasonStr, leagueId: leagueIdNum, limit: 4 },
      }),
    ]).then(([r, pr, apr, prRanks, aprRanks, st, sh, xgd, ustat, similarProfiles]) => {
      if (!isCurrent) return;
      const leaguePeerResponse = pr as PlayerPeerRatingResponse;
      const allPeerResponse = apr as PlayerPeerRatingResponse;
      setRatings(r);
      setPeerRating(leaguePeerResponse.peerRating);
      setAllPeerRating(allPeerResponse.peerRating);
      setPeerMetricRanks(prRanks as Record<string, PeerMetricRank>);
      setAllPeerMetricRanks(aprRanks as Record<string, PeerMetricRank>);
      setStats(st as PlayerStats | null);
      setShots(sh as Shot[]);
      const rawDelta = (xgd as any)?.delta;
      setXgotDelta(rawDelta != null ? Number(rawDelta) : null);
      setUnderstat(ustat as PlayerUnderstat | null);
      setSimilarRoleProfiles(similarProfiles as SimilarRoleProfile[]);
      setLoading(false);
      setSeasonLoading(false);
    });
    return () => { isCurrent = false; };
  }, [id, season]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-10 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (!player) {
    return <div className="text-muted-foreground">Player not found.</div>;
  }

  const avgRating =
    ratings.length > 0
      ? ratings.reduce((sum, r) => sum + Number(r.final_rating), 0) /
        ratings.length
      : 0;

  const contentClass = seasonLoading
    ? "opacity-50 pointer-events-none transition-opacity"
    : "";

  const isST = player.position === "ST" || player.position === "CF";
  const isCAM = player.position === "CAM";
  const playerPosition = (player.position ?? "").toUpperCase();
  const isWinger = ["LW", "RW", "LM", "RM"].includes(playerPosition);
  const isCM = ["CM", "CDM", "DM", "MID", "MIDFIELDER"].includes(playerPosition);
  const isCDM = false;
  const isDefensiveWinger = false;
  const isDefender =
    player.position === "CB" ||
    player.position === "LB" ||
    player.position === "RB" ||
    player.position === "LWB" ||
    player.position === "RWB" ||
    player.position === "DEF" ||
    player.position === "DEFENDER";
  const isSupported = isST || isCAM || isWinger || isCM || isDefender;

  // Passing computed values
  const passesCompleted = stats ? (stats.passes_completed ?? 0) : 0;
  const passesTotal = stats ? (stats.passes_total ?? 0) : 0;
  const passesCompletedPer90 =
    stats && stats.minutes > 0 ? (passesCompleted / stats.minutes) * 90 : 0;
  const passingAccuracy =
    passesTotal > 0 ? passesCompleted / passesTotal : null;
  const accurateLongBallsPer90 =
    stats && stats.minutes > 0
      ? ((stats.accurate_long_balls ?? 0) / stats.minutes) * 90
      : 0;
  const longBallAccuracy =
    (stats?.total_long_balls ?? 0) > 0
      ? (stats?.accurate_long_balls ?? 0) / (stats?.total_long_balls ?? 1)
      : null;

  const activePeerRating = peerScope === "league" ? peerRating : allPeerRating;
  const activePeerMetricRanks = peerScope === "league" ? peerMetricRanks : allPeerMetricRanks;
  const roleArchetype = formatRoleArchetype(
    activePeerRating?.role_archetype ?? activePeerRating?.cm_archetype,
  );
  const ratingMethodVariant = methodVariantForPosition(
    activePeerRating?.position ?? player.position,
  );
  const activePeerMinMinutes = 300;
  const percentileHasEnoughTotalMinutes = (stats?.minutes ?? 0) >= PERCENTILE_MIN_MINUTES;
  const percentileHasData = percentileHasEnoughTotalMinutes && peerRating != null;
  const peerHasData = percentileHasData;
  const ratingPeerQualified = (activePeerRating?.rated_minutes ?? 0) >= activePeerMinMinutes;
  const peerQualified = percentileHasData;
  const preAssistPercentile = peerRating?.pass_to_assist_per90_percentile
    ?? (peerQualified && stats?.pass_to_assist != null ? 0 : undefined);
  const activePreAssistPercentile =
    activePeerRating?.pass_to_assist_per90_percentile
    ?? (ratingPeerQualified && stats?.pass_to_assist != null ? 0 : null);
  const currentSeason = seasons.find((s) => `${s.league_id}|${s.season}` === season);
  const comparisonPool = `${peerScope === "league" ? (currentSeason?.league_name ?? "this league") : "all tracked leagues"} ${currentSeason?.season ?? season.split("|")[1] ?? ""}`;
  const peerDimensionRows = activePeerRating
    ? getPeerDimensionRows(
        activePeerRating,
        { isWinger, isCAM, isCM, isDefender },
        activePreAssistPercentile ?? undefined,
      )
    : [];
  const bestSignals = strongestSignals(peerDimensionRows);
  const weakSignals = strongestSignals(peerDimensionRows, true);
  const scoutSummary = scoutingSummaryCopy(peerDimensionRows, activePeerMetricRanks, roleArchetype);
  const cmReport = isCM && activePeerRating
    ? cmScoutReport(peerDimensionRows, activePeerMetricRanks, activePeerRating)
    : null;
  const stReport = isST && activePeerRating
    ? stScoutReport(peerDimensionRows, activePeerMetricRanks, activePeerRating)
    : null;
  const wingerReport = isWinger && activePeerRating
    ? wingerScoutReport(peerDimensionRows, activePeerRating)
    : null;
  const camReport = isCAM && activePeerRating
    ? camScoutReport(peerDimensionRows, activePeerMetricRanks, activePeerRating)
    : null;
  const defenderReport = isDefender && activePeerRating
    ? defenderScoutReport(peerDimensionRows, activePeerRating, stats)
    : null;
  const attackingScoutReport = stReport
    ? {
        report: stReport,
        title: "ST Scout Report",
        emptyWarning: "No major ST-specific statistical warning in this peer pool.",
        seasonTitle: "Season Finishing Context",
      }
    : wingerReport
      ? {
          report: wingerReport,
          title: "Winger Scout Report",
          emptyWarning: "No major winger-specific statistical warning in this peer pool.",
          seasonTitle: "Season Wide-Play Context",
        }
      : camReport
        ? {
            report: camReport,
            title: "AM Scout Report",
            emptyWarning: "No major AM-specific statistical warning in this peer pool.",
            seasonTitle: "Season Creation Context",
          }
        : defenderReport
          ? {
              report: defenderReport,
              title: playerPosition === "CB" ? "CB Scout Report" : "Defender Scout Report",
              emptyWarning: "No major defender-specific statistical warning in this peer pool.",
              seasonTitle: "Season Defensive Context",
            }
      : null;
  const socialScoutingReport: SocialScoutingReportCardProps | null =
    activePeerRating && attackingScoutReport
      ? {
          playerName: player.name,
          teamName: player.team?.name,
          positionLabel: activePeerRating.position ?? player.position,
          seasonLabel: currentSeason?.season ?? season.split("|")[1],
          comparisonPool,
          headline: attackingScoutReport.report.headline,
          topSignals: socialMetricRows(attackingScoutReport.report.top, activePeerMetricRanks),
          usageItems: attackingScoutReport.report.usageItems,
          concernItems: [
            ...attackingScoutReport.report.concernItems,
            ...attackingScoutReport.report.notExpectItems,
          ],
          evidenceRows: socialMetricRows(attackingScoutReport.report.evidenceRows, activePeerMetricRanks),
          seasonRows: attackingScoutReport.report.seasonRows,
          modelScore: activePeerRating.model_score,
          confidence: activePeerRating.model_score_confidence,
          ratedMinutes: activePeerRating.rated_minutes,
        }
      : activePeerRating && cmReport
        ? {
            playerName: player.name,
            teamName: player.team?.name,
            positionLabel: activePeerRating.position ?? player.position,
            seasonLabel: currentSeason?.season ?? season.split("|")[1],
            comparisonPool,
            headline: cmReport.headline,
            topSignals: socialMetricRows(cmReport.top, activePeerMetricRanks),
            usageItems: cmReport.usageItems,
            concernItems: [...cmReport.concernItems, ...cmReport.notExpectItems],
            evidenceRows: socialMetricRows(cmReport.evidenceRows, activePeerMetricRanks),
            seasonRows: cmReport.seasonOnlyRows,
            modelScore: activePeerRating.model_score,
            confidence: activePeerRating.model_score_confidence,
            ratedMinutes: activePeerRating.rated_minutes,
          }
        : null;
  const confidenceMessage = confidenceCopy(
    activePeerRating?.model_score_confidence,
    activePeerRating?.rated_minutes,
  );
  const extraPassingRows = [
    {
      label: "Final-third passes (season)",
      value: fmtModeValue(
        statMode,
        stats?.accurate_final_third_passes_per90,
        stats?.accurate_final_third_passes,
        statMode === "per90" ? 2 : 0,
      ),
      percentile: pct(
        peerRating?.accurate_final_third_passes_per90_percentile,
        peerRating?.accurate_final_third_passes_raw_percentile,
        statMode,
        peerQualified,
      ),
    },
    {
      label: "Pre-assists (season)",
      value: fmtModeValue(
        statMode,
        stats?.pass_to_assist_per90,
        stats?.pass_to_assist,
        statMode === "per90" ? 2 : 0,
      ),
      percentile: pct(
        peerRating?.pass_to_assist_per90_percentile,
        peerRating?.pass_to_assist_raw_percentile,
        statMode,
        peerQualified,
      ) ?? preAssistPercentile,
    },
    {
      label: "Pass value",
      value: fmt(stats?.pass_value_normalized, 2),
      percentile: peerQualified
        ? (peerRating?.pass_value_normalized_percentile ?? 0)
        : 0,
    },
  ];
  const progressiveCarryDistanceRow = {
    label: "Progressive carries distance",
    value: fmtModeValue(
      statMode,
      stats?.progressive_carries_distance_per90,
      stats?.progressive_carries_distance,
      2,
    ),
    percentile: pct(
      peerRating?.progressive_carries_distance_per90_percentile,
      peerRating?.progressive_carries_distance_raw_percentile,
      statMode,
      peerQualified,
    ),
  };

  const heroLeagueName =
    seasons.find((s) => `${s.league_id}|${s.season}` === season)?.league_name ??
    (player.team as any)?.league?.name;
  const heroAge = calculateAge(player.date_of_birth);
  const heroTeamName = stats?.team_name ?? (player.team as any)?.name;

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* ── Layer 1: Hero Header ─────────────────────────────────────────── */}
      <button onClick={() => window.history.back()} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1">
        <ArrowLeft size={14} /> Back
      </button>
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
            {/* Identity: avatar + name/meta + rating badge */}
            <div className="flex flex-1 items-start gap-3 min-w-0">
              <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-secondary text-lg sm:text-xl font-bold text-primary">
                {player.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg sm:text-xl font-bold leading-tight truncate">{player.name}</h1>
                {(player.position || heroTeamName) && (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {player.position && (
                      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                        {player.position}
                      </span>
                    )}
                    {player.position && heroTeamName && (
                      <span className="text-xs text-muted-foreground">·</span>
                    )}
                    {heroTeamName && (
                      <span className="text-sm text-muted-foreground truncate">
                        {heroTeamName}
                      </span>
                    )}
                  </div>
                )}
                {(() => {
                  const meta = [
                    heroAge != null ? `${heroAge} yrs` : null,
                    player.nationality ?? null,
                    heroLeagueName ?? null,
                  ].filter(Boolean) as string[];
                  if (meta.length === 0) return null;
                  return (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {meta.join(" · ")}
                    </div>
                  );
                })()}
                {stats && avgRating > 0 && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {stats.matches ?? 0} apps · {stats.minutes?.toLocaleString() ?? 0} mins
                  </div>
                )}
              </div>

              {avgRating > 0 && (
                <div className="shrink-0 self-start">
                  <RatingBadge
                    rating={Number(avgRating.toFixed(2))}
                    size="lg"
                  />
                </div>
              )}
            </div>

            {/* Season selector — full width on mobile, sits to the right on desktop */}
            {seasons.length > 0 && (
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full md:w-auto md:shrink-0 md:self-start rounded-lg border border-border bg-card px-3 py-2 md:py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {seasons.map((s) => (
                  <option
                    key={`${s.league_id}-${s.season}`}
                    value={`${s.league_id}|${s.season}`}
                  >
                    {s.league_name} {s.season}
                  </option>
                ))}
              </select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Season-filtered content */}
      <div className={contentClass}>
        <div className="sticky top-14 z-30 -mx-4 mt-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:mx-0 sm:mt-4 sm:px-0">
          <div className="flex gap-0.5 overflow-x-auto sm:gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { id: "overview", label: "Overview" },
              { id: "stats", label: "Stats" },
              { id: "scouting", label: "Report" },
              { id: "matches", label: "Matches" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as PlayerTab)}
                className={`flex-1 shrink-0 sm:flex-none border-b-2 px-2 sm:px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {/* ── Detailed Stats — all outfield positions ───────────────── */}
        {stats ? (
          <>
            {activeTab === "overview" && (
              <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1fr]">
                {activePeerRating?.role_fit && (
                  <RoleFitCard
                    roleFit={activePeerRating.role_fit}
                    similarProfiles={peerScope === "league" ? similarRoleProfiles : []}
                  />
                )}

                <Card className="lg:col-span-2">
                  <CardContent className="p-4 sm:p-5">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Read
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-semibold text-emerald-400">Best signals</div>
                        <div className="space-y-2.5">
                          {bestSignals.length > 0 ? bestSignals.map((row) => {
                            const v = Math.max(0, Math.min(100, Math.round(Number(row.value))));
                            const tone =
                              v >= 70 ? "bg-emerald-500" : v >= 50 ? "bg-emerald-500/70" : "bg-muted-foreground/40";
                            return (
                              <div key={`overview-best-${row.label}`} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-3 text-xs">
                                  <span className="text-foreground truncate">{row.label}</span>
                                  <span className="font-bold tabular-nums text-foreground">{v}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div className={`h-full rounded-full ${tone}`} style={{ width: `${v}%` }} />
                                </div>
                              </div>
                            );
                          }) : (
                            <div className="text-xs text-muted-foreground">No peer signal yet.</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold text-amber-400">Watch areas</div>
                        <div className="space-y-2.5">
                          {weakSignals.length > 0 ? weakSignals.map((row) => {
                            const v = Math.max(0, Math.min(100, Math.round(Number(row.value))));
                            const tone =
                              v <= 20 ? "bg-red-500" : v <= 40 ? "bg-amber-500" : "bg-muted-foreground/40";
                            return (
                              <div key={`overview-watch-${row.label}`} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-3 text-xs">
                                  <span className="text-foreground truncate">{row.label}</span>
                                  <span className="font-bold tabular-nums text-foreground">{v}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div className={`h-full rounded-full ${tone}`} style={{ width: `${v}%` }} />
                                </div>
                              </div>
                            );
                          }) : (
                            <div className="text-xs text-muted-foreground">No peer signal yet.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {seasonTrend.length > 0 && (
                  <Card className="lg:col-span-2">
                    <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
                      <CardTitle>Know Ball Score by Season</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 sm:p-6 sm:pt-2">
                      <SeasonTrendChart activeSeasonKey={season} points={seasonTrend} />
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
            {activeTab === "stats" && (
            <Card className="mt-4 overflow-hidden" ref={percentileCardRef}>
              <CardContent className="p-4 sm:p-6">
                {/* ── Header with toggles ───────────────────────────── */}
                <div className="mb-6">
                  {/* Title row (and toolbar inline on desktop) */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <h2 className="mb-0.5 text-lg font-semibold text-foreground">
                        {player.name}
                      </h2>
                      <h3 className="text-sm font-medium text-foreground">
                        Percentile rankings
                      </h3>
                    </div>
                    <div
                      ref={controlsRef}
                      className="flex flex-wrap gap-2 sm:shrink-0"
                    >
                    {/* Stat mode toggle */}
                    <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                      <button
                        onClick={() => setStatMode("per90")}
                        className={`min-h-9 rounded-md px-3 py-1.5 transition-colors ${statMode === "per90" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Per 90
                      </button>
                      <button
                        onClick={() => setStatMode("raw")}
                        className={`min-h-9 rounded-md px-3 py-1.5 transition-colors ${statMode === "raw" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Raw
                      </button>
                    </div>
                    {/* View mode toggle */}
                    <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                      <button
                        onClick={() => setViewMode("bars")}
                        className={`min-h-9 rounded-md px-3 py-1.5 transition-colors ${viewMode === "bars" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Bars
                      </button>
                      <button
                        onClick={() => setViewMode("pizza")}
                        className={`min-h-9 rounded-md px-3 py-1.5 transition-colors ${viewMode === "pizza" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Pizza
                      </button>
                    </div>
                    {/* Download button — desktop only */}
                    <button
                      onClick={handleDownloadPercentiles}
                      disabled={downloading || !peerHasData}
                      className="hidden min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50 sm:flex"
                      title="Download as PNG"
                    >
                      {downloading ? (
                        <span className="text-[11px]">Downloading...</span>
                      ) : (
                        <>
                          <Download size={14} />
                          <span>PNG</span>
                        </>
                      )}
                    </button>
                    </div>
                  </div>
                  <div className="mt-3 sm:mt-2">
                    <p className="text-xs text-muted-foreground">
                      vs{" "}
                      {POSITION_LABELS[peerRating?.position ?? player.position ?? "ST"] ??
                        peerRating?.position ??
                        player.position ??
                        "Strikers"}{" "}
                      in{" "}
                      {seasons.find(
                        (s) => `${s.league_id}|${s.season}` === season,
                      )?.league_name ??
                        (player.team as any)?.league?.name ??
                        "this league"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {stats.matches} apps ·{" "}
                      {stats.minutes?.toLocaleString() ?? 0} mins
                    </p>
                  </div>
                  {!percentileHasEnoughTotalMinutes && (
                    <div className="mt-3 rounded-md border border-band-warn/30 bg-band-warn/10 px-3 py-2 text-xs text-band-warn">
                      Limited game time — percentile data requires {PERCENTILE_MIN_MINUTES}+ total minutes played ({stats.minutes ?? 0} mins)
                    </div>
                  )}
                </div>

                {!percentileHasEnoughTotalMinutes ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <p>Percentile rankings require {PERCENTILE_MIN_MINUTES}+ total minutes played.</p>
                  </div>
                ) : !peerHasData ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <p>No percentile row available for this role yet.</p>
                  </div>
                ) : viewMode === "pizza" ? (
                  <div className="mb-6">
                    <PizzaChart
                      data={getPizzaMetrics(
                        { isST, isCAM, isWinger, isDefensiveWinger, isCM, isCDM, isDefender },
                        peerRating,
                        statMode,
                        peerQualified,
                      )}
                    />
                  </div>
                ) : isST ? (
                  <>
                    {/* Goalscoring */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goalscoring
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "xG + xA per 90" : "xG + xA"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_plus_xa_per90)
                              : fmt(
                                  (Number(stats.xg) || 0) +
                                    (Number(stats.xa) || 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.xg_plus_xa_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances created / 90"
                              : "Big chances created"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.big_chance_created_per90 ??
                                    stats.big_chances_created_per90,
                                )
                              : String(stats.big_chances_created ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_created_percentile,
                            peerRating?.big_chances_created_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls won / 90"
                              : "Fouls won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_won_per90)
                              : String(stats.fouls_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.fouls_won_per90_percentile,
                            peerRating?.fouls_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Penalties won"
                          value={String(stats.penalties_won ?? 0)}
                          percentile={
                            peerQualified
                              ? (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Overall duel win %"
                          value={fmtPct(
                            stats.aerials_won != null &&
                              stats.ground_duels_won != null &&
                              stats.total_contest_per90 != null
                              ? (stats.aerials_won + stats.ground_duels_won) /
                                  Math.max(
                                    1,
                                    stats.aerials_won +
                                      (stats.aerials_lost ?? 0) +
                                      stats.ground_duels_won +
                                      (stats.ground_duels_lost ?? 0),
                                  )
                              : null,
                          )}
                          percentile={
                            peerQualified
                              ? (peerRating?.physical_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Pressing & Recovery */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>
                  </>
                ) : isCAM ? (
                  <>
                    {/* CAM — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "xG + xA per 90" : "xG + xA"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_plus_xa_per90)
                              : fmt(
                                  (Number(stats.xg) || 0) +
                                    (Number(stats.xa) || 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.xg_plus_xa_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances created / 90"
                              : "Big chances created"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.big_chance_created_per90 ??
                                    stats.big_chances_created_per90,
                                )
                              : String(stats.big_chances_created ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_created_percentile,
                            peerRating?.big_chances_created_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CAM — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {extraPassingRows.map((row) => (
                          <StatRow key={row.label} {...row} />
                        ))}
                      </div>
                    </div>

                    {/* CAM — Goal Threat */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* CAM — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls won / 90"
                              : "Fouls won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_won_per90)
                              : String(stats.fouls_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.fouls_won_per90_percentile,
                            peerRating?.fouls_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow {...progressiveCarryDistanceRow} />
                      </div>
                    </div>

                    {/* CAM — Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CAM — Pressing & Recovery */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>
                  </>
                ) : isWinger ? (
                  <>
                    {/* Winger — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "xG + xA per 90" : "xG + xA"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_plus_xa_per90)
                              : fmt(
                                  (Number(stats.xg) || 0) +
                                    (Number(stats.xa) || 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.xg_plus_xa_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances created / 90"
                              : "Big chances created"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.big_chance_created_per90 ??
                                    stats.big_chances_created_per90,
                                )
                              : String(stats.big_chances_created ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_created_percentile,
                            peerRating?.big_chances_created_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Winger — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Winger — Goal Threat */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Winger — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls won / 90"
                              : "Fouls won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_won_per90)
                              : String(stats.fouls_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.fouls_won_per90_percentile,
                            peerRating?.fouls_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Winger — Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Winger — Pressing & Recovery */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>
                  </>
                ) : isDefensiveWinger ? (
                  <>
                    {/* Defensive Winger — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "xG + xA per 90" : "xG + xA"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_plus_xa_per90)
                              : fmt(
                                  (Number(stats.xg) || 0) +
                                    (Number(stats.xa) || 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.xg_plus_xa_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Defensive Winger — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Defensive Winger — Pressing & Recovery */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Defensive Winger — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Defensive Winger — Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Defensive Winger — Goal Threat */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : isCM ? (
                  <>
                    {/* CM — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "xG + xA per 90" : "xG + xA"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_plus_xa_per90)
                              : fmt(
                                  (Number(stats.xg) || 0) +
                                    (Number(stats.xa) || 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.xg_plus_xa_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances created / 90"
                              : "Big chances created"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.big_chance_created_per90 ??
                                    stats.big_chances_created_per90,
                                )
                              : String(stats.big_chances_created ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_created_percentile,
                            peerRating?.big_chances_created_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CM — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {extraPassingRows.map((row) => (
                          <StatRow key={row.label} {...row} />
                        ))}
                      </div>
                    </div>

                    {/* CM — Goal Threat */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* CM — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls won / 90"
                              : "Fouls won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_won_per90)
                              : String(stats.fouls_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.fouls_won_per90_percentile,
                            peerRating?.fouls_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow {...progressiveCarryDistanceRow} />
                      </div>
                    </div>

                    {/* CM — Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CM — Pressing & Recovery */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>
                  </>
                ) : isCDM ? (
                  <>
                    {/* CDM — Pressing & Recovery (first) */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CDM — Physical Duels */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CDM — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Successful dribbles / 90"
                              : "Successful dribbles"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.dribbles_per90)
                              : String(stats.dribbles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.dribbles_per90_percentile,
                            peerRating?.dribbles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls won / 90"
                              : "Fouls won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_won_per90)
                              : String(stats.fouls_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.fouls_won_per90_percentile,
                            peerRating?.fouls_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* CDM — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances created / 90"
                              : "Big chances created"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.big_chance_created_per90 ??
                                    stats.big_chances_created_per90,
                                )
                              : String(stats.big_chances_created ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_created_percentile,
                            peerRating?.big_chances_created_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* CDM — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* CDM — Goal Threat */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : isDefender ? (
                  <>
                    {/* Defender — Physical Duels (first) */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Physical duels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Aerial win %"
                          value={fmtPct(stats.aerial_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.aerial_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Aerial wins / 90"
                              : "Aerial wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.aerials_per90)
                              : String(stats.aerials_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.aerials_per90_percentile,
                            peerRating?.aerials_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Ground duel win %"
                          value={fmtPct(stats.ground_duel_win_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.ground_duel_win_rate_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ground duel wins / 90"
                              : "Ground duel wins"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.ground_duels_won_per90)
                              : String(stats.ground_duels_won ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ground_duels_won_per90_percentile,
                            peerRating?.ground_duels_won_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Total contests / 90"
                              : "Total contests"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.total_contest_per90)
                              : String(
                                  (stats.aerials_won ?? 0) +
                                    (stats.aerials_lost ?? 0) +
                                    (stats.ground_duels_won ?? 0) +
                                    (stats.ground_duels_lost ?? 0),
                                )
                          }
                          percentile={pct(
                            peerRating?.total_contest_per90_percentile,
                            peerRating?.total_contests_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Overall duel win %"
                          value={fmtPct(
                            stats.aerials_won != null &&
                              stats.ground_duels_won != null
                              ? (stats.aerials_won + stats.ground_duels_won) /
                                  Math.max(
                                    1,
                                    stats.aerials_won +
                                      (stats.aerials_lost ?? 0) +
                                      stats.ground_duels_won +
                                      (stats.ground_duels_lost ?? 0),
                                  )
                              : null,
                          )}
                          percentile={
                            peerQualified
                              ? (peerRating?.physical_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Defender — Pressing & Recovery */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Defending
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Ball recoveries / 90"
                              : "Ball recoveries"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(
                                  stats.ball_recovery_per90 ??
                                    stats.ball_recoveries_per90,
                                )
                              : String(stats.ball_recoveries ?? 0)
                          }
                          percentile={pct(
                            peerRating?.ball_recoveries_per90_percentile,
                            peerRating?.ball_recoveries_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Tackles won / 90"
                              : "Tackles won"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.tackles_per90)
                              : String(stats.tackles ?? 0)
                          }
                          percentile={pct(
                            peerRating?.tackles_per90_percentile,
                            peerRating?.tackles_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Interceptions / 90"
                              : "Interceptions"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.interceptions_per90)
                              : String(stats.interceptions ?? 0)
                          }
                          percentile={pct(
                            peerRating?.interceptions_per90_percentile,
                            peerRating?.interceptions_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Fouls committed / 90"
                              : "Fouls committed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.fouls_committed_per90)
                              : String(stats.fouls_committed ?? 0)
                          }
                          percentile={pct(
                            100 - (peerRating?.pressing_percentile ?? 0),
                            peerRating?.fouls_committed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Defender — Ball Carrying */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Ball carrying
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label="Dribble success %"
                          value={fmtPct(stats.dribble_success_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.dribble_success_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Touches per 90" : "Touches"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.touches_per90)
                              : String(stats.touches ?? 0)
                          }
                          percentile={pct(
                            peerRating?.touches_per90_percentile,
                            peerRating?.touches_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Possession loss rate"
                          value={fmtPct(stats.possession_loss_rate)}
                          percentile={
                            peerQualified
                              ? 100 - (peerRating?.carrying_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Defender — Passing */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Passing
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "Passes /90" : "Passes"}
                          value={
                            statMode === "per90"
                              ? fmt(passesCompletedPer90, 1)
                              : String(passesCompleted)
                          }
                          percentile={pct(
                            peerRating?.passes_completed_per90_percentile,
                            peerRating?.passes_completed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Passing accuracy"
                          value={fmtPct(passingAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.passing_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90" ? "xG Chain /90" : "xG Chain"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_chain_per90)
                                : fmt(understat.xg_chain)
                            }
                            percentile={pct(
                              peerRating?.xg_chain_per90_percentile,
                              peerRating?.xg_chain_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        {understat && (
                          <StatRow
                            label={
                              statMode === "per90"
                                ? "xG Buildup /90"
                                : "xG Buildup"
                            }
                            value={
                              statMode === "per90"
                                ? fmt(understat.xg_buildup_per90)
                                : fmt(understat.xg_buildup)
                            }
                            percentile={pct(
                              peerRating?.xg_buildup_per90_percentile,
                              peerRating?.xg_buildup_raw_percentile,
                              statMode,
                              peerQualified,
                            )}
                          />
                        )}
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate long balls /90"
                              : "Accurate long balls"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(accurateLongBallsPer90, 1)
                              : String(stats.accurate_long_balls ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_long_balls_per90_percentile,
                            peerRating?.accurate_long_balls_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Long ball accuracy"
                          value={fmtPct(longBallAccuracy)}
                          percentile={
                            peerQualified
                              ? (peerRating?.long_ball_accuracy_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>

                    {/* Defender — Chance Creation */}
                    <div className="mb-6 sm:mb-8">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Chance creation
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={statMode === "per90" ? "xA per 90" : "xA"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xa_per90)
                              : fmt(stats.xa)
                          }
                          percentile={pct(
                            peerRating?.xa_per90_percentile,
                            peerRating?.xa_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Assists per 90" : "Assists"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.assists_per90)
                              : String(stats.assists ?? 0)
                          }
                          percentile={pct(
                            peerRating?.assists_per90_percentile,
                            peerRating?.assists_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Accurate crosses / 90"
                              : "Accurate crosses"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.accurate_cross_per90)
                              : String(stats.accurate_cross ?? 0)
                          }
                          percentile={pct(
                            peerRating?.accurate_cross_per90_percentile,
                            peerRating?.accurate_cross_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Key passes per 90"
                              : "Key passes"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.key_passes_per90)
                              : String(stats.key_passes ?? 0)
                          }
                          percentile={pct(
                            peerRating?.key_passes_per90_percentile,
                            peerRating?.key_passes_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                      </div>
                    </div>

                    {/* Defender — Goal Threat */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Goal threat
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-0.5">
                        <StatRow
                          label={
                            statMode === "per90" ? "Goals per 90" : "Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.goals_per90)
                              : String(stats.goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.goals_per90_percentile,
                            peerRating?.goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "Shots per 90" : "Shots"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.shots_per90)
                              : String(stats.shots ?? 0)
                          }
                          percentile={pct(
                            peerRating?.shots_per90_percentile,
                            peerRating?.shots_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={statMode === "per90" ? "xG per 90" : "xG"}
                          value={
                            statMode === "per90"
                              ? fmt(stats.xg_per90)
                              : fmt(stats.xg)
                          }
                          percentile={pct(
                            peerRating?.xg_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="Shot on target %"
                          value={fmtPct(stats.shot_on_target_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_on_target_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="xG per shot"
                          value={fmt(stats.xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label="Shot conversion %"
                          value={fmtPct(stats.shot_conversion_rate)}
                          percentile={
                            peerQualified
                              ? (peerRating?.shot_conversion_percentile ?? 0)
                              : 0
                          }
                        />
                        <StatRow
                          label={statMode === "per90" ? "xGOT per 90" : "xGOT"}
                          value={fmt(stats.xgot_per90)}
                          percentile={pct(
                            peerRating?.xgot_per90_percentile,
                            peerRating?.xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "Big chances missed / 90"
                              : "Big chances missed"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.big_chances_missed_per90)
                              : String(stats.big_chances_missed ?? 0)
                          }
                          percentile={pct(
                            peerRating?.big_chances_missed_percentile,
                            peerRating?.big_chances_missed_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90"
                              ? "np Goals per 90"
                              : "np Goals"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_goals_per90)
                              : String(stats.np_goals ?? 0)
                          }
                          percentile={pct(
                            peerRating?.np_goals_per90_percentile,
                            peerRating?.np_goals_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label={
                            statMode === "per90" ? "np xG per 90" : "np xG"
                          }
                          value={
                            statMode === "per90"
                              ? fmt(stats.np_xg_per90)
                              : fmt(stats.np_xg_total)
                          }
                          percentile={pct(
                            peerRating?.np_xg_per90_percentile,
                            peerRating?.np_xg_raw_percentile,
                            statMode,
                            peerQualified,
                          )}
                        />
                        <StatRow
                          label="np xG per shot"
                          value={fmt(stats.np_xg_per_shot, 2)}
                          percentile={
                            peerQualified
                              ? (peerRating?.np_xg_per_shot_percentile ?? 0)
                              : 0
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : null}
                {/* ── Watermark ───────────────────────────── */}
                <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground">
                  <span>
                    {
                      seasons.find(
                        (s) => `${s.league_id}|${s.season}` === season,
                      )?.league_name
                    }{" "}
                    {
                      seasons.find(
                        (s) => `${s.league_id}|${s.season}` === season,
                      )?.season
                    }
                  </span>
                  <span className="font-medium">Know Ball</span>
                </div>
              </CardContent>
            </Card>
            )}

            {/* ── Peer Comparison ──────────────────────────────────────────── */}
            {activeTab === "scouting" && (
            <>
            <RatingMethodNote variant={ratingMethodVariant} />
            {socialScoutingReport && scoutExportLayerVisible && (
              <div
                aria-hidden="true"
                style={{
                  position: "fixed",
                  left: -99999,
                  top: 0,
                  pointerEvents: "none",
                  opacity: 0,
                }}
              >
                <div ref={scoutingSocialCardRef} style={{ width: 1080, height: 1350 }}>
                  <SocialScoutingReportCard {...socialScoutingReport} />
                </div>
              </div>
            )}
            <Card className="mt-4">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Peer comparison
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleExportScoutReport}
                      disabled={
                        scoutDownloading ||
                        socialScoutingReport == null ||
                        activePeerRating == null ||
                        (activePeerRating.rated_minutes ?? 0) < activePeerMinMinutes
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                      title="Export scouting report"
                    >
                      <Download size={14} />
                      <span>{scoutDownloading ? "Exporting..." : "Export"}</span>
                    </button>
                    <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                      <button
                        onClick={() => setPeerScope("league")}
                        className={`rounded-md px-3 py-1 transition-colors ${peerScope === "league" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        This league
                      </button>
                      <button
                        onClick={() => setPeerScope("all")}
                        className={`rounded-md px-3 py-1 transition-colors ${peerScope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        All leagues
                      </button>
                    </div>
                  </div>
                </div>
                {activePeerRating == null ? (
                  <div className="py-4 text-[13px] text-muted-foreground">
                    No peer comparison data available.
                  </div>
                ) : (activePeerRating.rated_minutes ?? 0) < activePeerMinMinutes ? (
                  <div className="py-4 text-[13px] text-muted-foreground">
                    Peer comparison requires {activePeerMinMinutes}+ minutes rated as{" "}
                    {POSITION_LABELS[activePeerRating.position ?? player.position ?? "ST"] ??
                      activePeerRating.position ??
                      "Striker"}
                    . Currently {activePeerRating.rated_minutes ?? 0} mins.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Top row: Score + Match Profile side-by-side at lg+ */}
                    <div className="grid items-stretch gap-3 lg:grid-cols-2">
                      {/* Model score */}
                      {activePeerRating.model_score != null && (() => {
                        const score = Number(activePeerRating.model_score);
                        const fillPct = Math.max(0, Math.min(100, score));
                        const scoreTone =
                          score >= 60
                            ? "text-rating-high"
                            : score >= 45
                              ? "text-rating-mid"
                              : "text-rating-low";
                        const fillBg =
                          score >= 60
                            ? "bg-rating-high"
                            : score >= 45
                              ? "bg-rating-mid"
                              : "bg-rating-low";
                        const band = scoreConfidenceBand(
                          activePeerRating.model_score_confidence,
                          activePeerRating.rated_minutes,
                        );
                        const bandClass =
                          band === "limited"
                            ? "border-rating-mid/30 bg-rating-mid/10 text-rating-mid"
                            : band === "trusted"
                              ? "border-rating-high/30 bg-rating-high/10 text-rating-high"
                              : "border-border bg-card text-muted-foreground";
                        const lowConfidence =
                          Number(activePeerRating.model_score_confidence ?? 0) < 45;
                        return (
                          <div className="flex h-full flex-col gap-2.5 rounded-lg bg-muted px-3.5 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Know Ball Score
                                </div>
                                <div className="mt-1 text-sm font-semibold text-foreground">
                                  {scoreCopy(activePeerRating.model_score, roleArchetype)}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-baseline gap-1">
                                <span className={`text-3xl font-bold leading-none tabular-nums ${scoreTone}`}>
                                  {score.toFixed(1)}
                                </span>
                                <span className="text-xs text-muted-foreground">/100</span>
                              </div>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-card">
                              <div
                                className={`h-full rounded-full transition-all ${fillBg}`}
                                style={{ width: `${fillPct}%` }}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {roleArchetype && (
                                <span className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-bold text-foreground">
                                  {roleArchetype}
                                </span>
                              )}
                              <span
                                title={scoreConfidenceDetail(
                                  activePeerRating.model_score_confidence,
                                  activePeerRating.rated_minutes,
                                )}
                                className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${bandClass}`}
                              >
                                {scoreConfidenceLabel(
                                  activePeerRating.model_score_confidence,
                                  activePeerRating.rated_minutes,
                                )}
                                {activePeerRating.model_score_confidence != null && (
                                  <> · {Math.round(Number(activePeerRating.model_score_confidence))}%</>
                                )}
                              </span>
                            </div>
                            {confidenceMessage && (
                              <p className={`m-0 text-[11px] ${lowConfidence ? "text-rating-mid" : "text-muted-foreground"}`}>
                                {confidenceMessage}
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {/* Match Profile (moved up from below scout report) */}
                      {(activePeerRating.consistency_score != null ||
                        activePeerRating.impact_rate != null) && (
                        <div className="flex h-full flex-col gap-2 rounded-lg bg-muted px-3.5 py-3">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Match Profile
                          </div>
                          {activePeerRating.consistency_score != null &&
                            (() => {
                              const val = Number(activePeerRating.consistency_score);
                              const filled = val / 10;
                              const labelColor = rateColor(val, 20, 70);
                              return (
                                <div>
                                  <div className="mb-1 flex items-baseline justify-between">
                                    <span className="text-xs font-medium text-foreground">
                                      Good Performance Rate
                                    </span>
                                    <span
                                      className="text-[15px] font-bold tabular-nums"
                                      style={{ color: labelColor }}
                                    >
                                      {val.toFixed(0)}%
                                    </span>
                                  </div>
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: 10 }, (_, i) => {
                                      const segMid = (i + 0.5) * 10;
                                      const opacity =
                                        filled >= i + 1
                                          ? 1
                                          : filled > i
                                            ? filled - i
                                            : 0;
                                      return (
                                        <div
                                          key={i}
                                          style={{
                                            flex: 1,
                                            height: 5,
                                            borderRadius: 2,
                                            background:
                                              opacity > 0
                                                ? rateColor(segMid, 20, 70)
                                                : "var(--border)",
                                            opacity:
                                              opacity > 0 && opacity < 1
                                                ? 0.5 + opacity * 0.5
                                                : 1,
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          {activePeerRating.impact_rate != null &&
                            (() => {
                              const val = Number(activePeerRating.impact_rate);
                              const filled = val / 10;
                              const labelColor = rateColor(val, 5, 35);
                              return (
                                <div>
                                  <div className="mb-1 flex items-baseline justify-between">
                                    <span className="text-xs font-medium text-foreground">
                                      Elite Performance Rate
                                    </span>
                                    <span
                                      className="text-[15px] font-bold tabular-nums"
                                      style={{ color: labelColor }}
                                    >
                                      {val.toFixed(0)}%
                                    </span>
                                  </div>
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: 10 }, (_, i) => {
                                      const segMid = (i + 0.5) * 10;
                                      const opacity =
                                        filled >= i + 1
                                          ? 1
                                          : filled > i
                                            ? filled - i
                                            : 0;
                                      return (
                                        <div
                                          key={i}
                                          style={{
                                            flex: 1,
                                            height: 5,
                                            borderRadius: 2,
                                            background:
                                              opacity > 0
                                                ? rateColor(segMid, 5, 35)
                                                : "var(--border)",
                                            opacity:
                                              opacity > 0 && opacity < 1
                                                ? 0.5 + opacity * 0.5
                                                : 1,
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          <p className="mt-auto pt-1 text-[11px] leading-relaxed text-muted-foreground">
                            Good = matches with a good performance. Elite = matches with an elite performance. Season rates, not peer rankings.
                          </p>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const r = attackingScoutReport
                        ? {
                            title: attackingScoutReport.title,
                            headline: attackingScoutReport.report.headline,
                            mainValue: attackingScoutReport.report.top.map((row): ScoutMetric => ({
                              key: row.metricKey,
                              label: row.label,
                              valueText: rowRankText(row, activePeerMetricRanks),
                              tone: bandTone(row.value),
                            })),
                            useFor: attackingScoutReport.report.usageItems,
                            caution: [...attackingScoutReport.report.concernItems, ...attackingScoutReport.report.notExpectItems],
                            emptyCaution: attackingScoutReport.emptyWarning,
                            evidence: attackingScoutReport.report.evidenceRows.map((row): ScoutMetric => ({
                              key: row.metricKey,
                              label: row.label,
                              valueText: rowRankText(row, activePeerMetricRanks),
                              tone: bandTone(row.value),
                            })),
                            seasonRows: attackingScoutReport.report.seasonRows.map((row): ScoutMetric => ({
                              key: row.label,
                              label: row.label,
                              valueText: row.rank,
                              tone: bandTone(row.value),
                            })),
                            seasonTitle: attackingScoutReport.seasonTitle,
                          }
                        : cmReport
                          ? {
                              title: "CM Scout Report",
                              headline: cmReport.headline,
                              mainValue: cmReport.top.map((row): ScoutMetric => ({
                                key: row.metricKey,
                                label: row.label,
                                valueText: rowRankText(row, activePeerMetricRanks),
                                tone: bandTone(row.value),
                              })),
                              useFor: cmReport.usageItems,
                              caution: [...cmReport.concernItems, ...cmReport.notExpectItems],
                              emptyCaution: "No major CM-specific statistical warning in this peer pool.",
                              evidence: cmReport.evidenceRows.map((row): ScoutMetric => ({
                                key: row.metricKey,
                                label: row.label,
                                valueText: rowRankText(row, activePeerMetricRanks),
                                tone: bandTone(row.value),
                              })),
                              seasonRows: cmReport.seasonOnlyRows.map((row): ScoutMetric => ({
                                key: row.label,
                                label: row.label,
                                valueText: row.rank,
                                tone: bandTone(row.value),
                              })),
                              seasonTitle: "Season Context",
                            }
                          : null;
                      if (!r) return null;
                      return (
                        <ScoutReportCard
                          title={r.title}
                          headline={r.headline}
                          ratedMinutes={activePeerRating.rated_minutes ?? 0}
                          comparisonPool={comparisonPool}
                          mainValue={r.mainValue}
                          useForItems={r.useFor}
                          cautionItems={r.caution}
                          emptyCautionText={r.emptyCaution}
                          evidenceRows={r.evidence}
                          seasonRows={r.seasonRows}
                          seasonTitle={r.seasonTitle}
                        />
                      );
                    })()}
                    {!attackingScoutReport && !cmReport && peerDimensionRows.length > 0 && (
                      <div className="flex flex-col gap-2.5 rounded-lg bg-muted px-3.5 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Scout Summary
                        </div>
                        {[
                          ["Strengths", scoutSummary.strengthText],
                          ["Caution", scoutSummary.cautionText],
                          ["Role Fit", scoutSummary.roleText],
                        ].map(([label, copy]) => (
                          <div key={label} className="grid grid-cols-[86px_1fr] gap-2.5">
                            <div className="text-xs font-bold text-foreground">
                              {label}
                            </div>
                            <div className="text-xs leading-relaxed text-muted-foreground">
                              {copy}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Description */}
                    <p className="m-0 text-[11px] text-muted-foreground">
                      Match Rating = individual games. Know Ball Score = season-level performance.
                      Rank = standing among rated players in this peer pool. Confidence = how much the sample is trusted.
                    </p>
                    {!attackingScoutReport && !cmReport && (
                      <div className="flex flex-col gap-2">
                        {peerDimensionRows.map((row) => {
                          const { label, sublabel, value } = row;
                          const pct = value ?? 0;
                          const barBg =
                            pct >= 70
                              ? "bg-band-good"
                              : pct >= 40
                                ? "bg-band-warn"
                                : "bg-band-bad";
                          const textTone =
                            pct >= 70
                              ? "text-band-good"
                              : pct >= 40
                                ? "text-band-warn"
                                : "text-band-bad";
                          return (
                            <div
                              key={label}
                              className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
                            >
                              <div className="flex items-baseline justify-between gap-3 sm:contents">
                                <span className="min-w-0 text-xs text-foreground sm:w-44 sm:shrink-0">
                                  {label}
                                  {sublabel && (
                                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                      {sublabel}
                                    </span>
                                  )}
                                </span>
                                <span className={`shrink-0 text-[13px] font-bold sm:order-3 sm:min-w-[28px] sm:text-right ${textTone}`}>
                                  {rankCopy(row, activePeerMetricRanks)}
                                </span>
                              </div>
                              <div className="relative h-2.5 overflow-hidden rounded-full bg-muted sm:order-2 sm:flex-1">
                                <div
                                  className={`h-full rounded-full ${barBg}`}
                                  style={{ width: `${pct}%` }}
                                />
                                {[25, 50, 75].map((tick) => (
                                  <div
                                    key={tick}
                                    className="absolute inset-y-0 w-px bg-background/60"
                                    style={{ left: `${tick}%` }}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            </>
            )}
          </>
        ) : (
          !isSupported && (
            <div className="p-8 text-sm text-muted-foreground">
              Detailed stats coming soon for this position.
            </div>
          )
        )}

        {/* ── Shot Profile ─────────────────────────────────────────────────── */}
        {activeTab === "stats" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Shot Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ShotProfile
              shots={shots}
              xgotDelta={xgotDelta}
              xgOverperformance={stats?.xg_overperformance}
            />
          </CardContent>
        </Card>
        )}

        {/* ── Matches ──────────────────────────────────────────────────────── */}
        {activeTab === "matches" && (
          <MatchesTab
            ratings={ratings}
            playerTeamId={player.current_team_id ?? player.team?.id ?? null}
            competitionLabel={(() => {
              const s = seasons.find((s) => `${s.league_id}|${s.season}` === season);
              const league = s?.league_name ?? (player.team as any)?.league?.name ?? "League";
              const seasonText = s?.season ?? season.split("|")[1] ?? "";
              return seasonText ? `${league} ${seasonText}` : league;
            })()}
          />
        )}
      </div>
    </div>
  );
}
