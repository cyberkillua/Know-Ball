import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { domToPng } from "modern-screenshot";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import RatingBadge from "../components/RatingBadge";
import RatingLineChart from "../components/charts/RatingLineChart";
import StatRow from "../components/StatRow";
import PizzaChart from "../components/charts/PizzaChart";
import {
  getPlayer,
  getPlayerSeasons,
  getPlayerRatings,
  getPlayerPeerRating,
  getPlayerStats,
  getPlayerShots,
  getPlayerXgotDelta,
  getPlayerUnderstat,
} from "../lib/queries";
import type {
  Player,
  MatchRating,
  PeerRating,
  PlayerPeerRatingResponse,
  PlayerStats,
  PlayerUnderstat,
  Shot,
} from "../lib/types";
import ShotProfile from "../components/ShotProfile";

export const Route = createFileRoute("/player/$id")({
  component: PlayerProfilePage,
});

const POSITION_LABELS: Record<string, string> = {
  ST: "Strikers",
  CF: "Centre-Forwards",
  LW: "Wingers",
  RW: "Wingers",
  WINGER: "Wingers",
  CAM: "Attacking Midfielders",
  CM: "Central Midfielders",
  CDM: "Defensive Midfielders",
  LM: "Left Midfielders",
  RM: "Right Midfielders",
  LB: "Left Backs",
  RB: "Right Backs",
  LWB: "Left Wing-Backs",
  RWB: "Right Wing-Backs",
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
  const [season, setSeason] = useState<string>("");
  const [ratings, setRatings] = useState<MatchRating[]>([]);
  const [peerRating, setPeerRating] = useState<PeerRating | null>(null);
  const [allPeerRating, setAllPeerRating] = useState<PeerRating | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [xgotDelta, setXgotDelta] = useState<number | null>(null);
  const [understat, setUnderstat] = useState<PlayerUnderstat | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [peerScope, setPeerScope] = useState<"league" | "all">("league");
  const [statMode, setStatMode] = useState<"per90" | "raw">("per90");
  const [viewMode, setViewMode] = useState<"bars" | "pizza">("bars");
  const percentileCardRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

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

  // Load player info and available seasons
  useEffect(() => {
    let isCurrent = true;
    const playerId = Number(id);
    setSeason(""); // reset stale season from previous player before fetching
    setLoading(true);
    Promise.all([
      getPlayer({ data: { playerId } }),
      getPlayerSeasons({ data: { playerId } }),
    ]).then(([p, s]) => {
      if (!isCurrent) return;
      setPlayer(p);
      setSeasons(s);
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
    ]).then(([r, pr, apr, st, sh, xgd, ustat]) => {
      if (!isCurrent) return;
      const leaguePeerResponse = pr as PlayerPeerRatingResponse;
      const allPeerResponse = apr as PlayerPeerRatingResponse;
      setRatings(r);
      setPeerRating(leaguePeerResponse.peerRating);
      setAllPeerRating(allPeerResponse.peerRating);
      setStats(st as PlayerStats | null);
      setShots(sh as Shot[]);
      const rawDelta = (xgd as any)?.delta;
      setXgotDelta(rawDelta != null ? Number(rawDelta) : null);
      setUnderstat(ustat as PlayerUnderstat | null);
      setLoading(false);
      setSeasonLoading(false);
    });
    return () => { isCurrent = false; };
  }, [id, season]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
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

  const last5 = ratings.slice(-5);
  const last5Avg =
    last5.length > 0
      ? last5.reduce((s, r) => s + Number(r.final_rating), 0) / last5.length
      : 0;
  const formDelta = avgRating > 0 ? last5Avg - avgRating : 0;

  const contentClass = seasonLoading
    ? "opacity-50 pointer-events-none transition-opacity"
    : "";

  const isST = player.position === "ST" || player.position === "CF";
  const isCAM = player.position === "CAM";
  const isWinger = player.position === "LW" || player.position === "RW";
  const isDefensiveWinger =
    player.position === "LM" || player.position === "RM";
  const isCM = player.position === "CM";
  const isCDM = player.position === "CDM";
  const isDefender =
    player.position === "CB" ||
    player.position === "LB" ||
    player.position === "RB" ||
    player.position === "LWB" ||
    player.position === "RWB";
  const isSupported = isST || isCAM || isWinger || isDefensiveWinger || isCM;

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
  const activePeerMinMinutes = 300;
  const percentileHasEnoughTotalMinutes = (stats?.minutes ?? 0) >= PERCENTILE_MIN_MINUTES;
  const percentileHasData = percentileHasEnoughTotalMinutes && peerRating != null;
  const peerHasData = percentileHasData;
  const ratingPeerQualified = (activePeerRating?.rated_minutes ?? 0) >= activePeerMinMinutes;
  const peerQualified = percentileHasData;

  return (
    <div className="space-y-6">
      {/* ── Layer 1: Hero Header ─────────────────────────────────────────── */}
      <button onClick={() => window.history.back()} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1">
        <ArrowLeft size={14} /> Back
      </button>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-secondary text-xl font-bold text-primary">
              {player.name.charAt(0)}
            </div>

            {/* Player identity + right section */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {/* Name + meta */}
                <div className="min-w-0">
                  <h1 className="text-xl font-bold leading-tight">{player.name}</h1>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {player.position && (
                      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                        {player.position}
                      </span>
                    )}
                    {(stats?.team_name || (player.team as any)?.name) && (
                      <>
                        <span className="text-muted-foreground text-xs">·</span>
                        <span className="text-sm text-muted-foreground">
                          {stats?.team_name ?? (player.team as any).name}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                    {calculateAge(player.date_of_birth) != null && (
                      <span>{calculateAge(player.date_of_birth)} yrs</span>
                    )}
                    {player.nationality && (
                      <>
                        {calculateAge(player.date_of_birth) != null && (
                          <span>·</span>
                        )}
                        <span>{player.nationality}</span>
                      </>
                    )}
                    {(seasons.find((s) => `${s.league_id}|${s.season}` === season)?.league_name ?? (player.team as any)?.league?.name) && (
                      <>
                        {(calculateAge(player.date_of_birth) != null ||
                          player.nationality) && <span>·</span>}
                        <span>{seasons.find((s) => `${s.league_id}|${s.season}` === season)?.league_name ?? (player.team as any)?.league?.name}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Season selector + rating stats */}
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {seasons.length > 0 && (
                    <select
                      value={season}
                      onChange={(e) => setSeason(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

                  {avgRating > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        {stats && (
                          <div className="text-xs text-muted-foreground mb-1">
                            {stats.matches} apps · {stats.minutes?.toLocaleString()}{" "}
                            mins
                          </div>
                        )}
                        {last5.length >= 3 && (
                          <div
                            className={`text-xs font-medium text-right ${
                              formDelta > 0.2
                                ? "text-emerald-400"
                                : formDelta < -0.2
                                  ? "text-red-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {formDelta > 0.2
                              ? "↑ In form"
                              : formDelta < -0.2
                                ? "↓ Out of form"
                                : "→ Steady"}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Rating
                        </div>
                        <RatingBadge
                          rating={Number(avgRating.toFixed(2))}
                          size="lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Season-filtered content */}
      <div className={contentClass}>
        {/* ── Detailed Stats — all outfield positions ───────────────── */}
        {stats ? (
          <>
            <Card className="mt-4" ref={percentileCardRef}>
              <CardContent className="p-6">
                {/* ── Header with toggles ───────────────────────────── */}
                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <h2
                          style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: "var(--foreground)",
                            marginBottom: 2,
                          }}
                        >
                          {player.name}
                        </h2>
                      </div>
                      <h3
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--foreground)",
                          marginBottom: 4,
                        }}
                      >
                        Percentile rankings
                      </h3>
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--muted-foreground)",
                        }}
                      >
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
                      <p
                        style={{
                          fontSize: 11,
                          color: "var(--muted-foreground)",
                          marginTop: 2,
                        }}
                      >
                        {stats.matches} apps ·{" "}
                        {stats.minutes?.toLocaleString() ?? 0} mins
                      </p>
                    </div>
                    <div
                      ref={controlsRef}
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      {/* Stat mode toggle */}
                      <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                        <button
                          onClick={() => setStatMode("per90")}
                          className={`rounded-md px-3 py-1 transition-colors ${statMode === "per90" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Per 90
                        </button>
                        <button
                          onClick={() => setStatMode("raw")}
                          className={`rounded-md px-3 py-1 transition-colors ${statMode === "raw" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Raw
                        </button>
                      </div>
                      {/* View mode toggle */}
                      <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                        <button
                          onClick={() => setViewMode("bars")}
                          className={`rounded-md px-3 py-1 transition-colors ${viewMode === "bars" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Bars
                        </button>
                        <button
                          onClick={() => setViewMode("pizza")}
                          className={`rounded-md px-3 py-1 transition-colors ${viewMode === "pizza" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Pizza
                        </button>
                      </div>
                      {/* Download button */}
                      <button
                        onClick={handleDownloadPercentiles}
                        disabled={downloading || !peerHasData}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                        title="Download as PNG"
                      >
                        {downloading ? (
                          <span style={{ fontSize: 11 }}>Downloading...</span>
                        ) : (
                          <>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" x2="12" y1="15" y2="3" />
                            </svg>
                            <span>PNG</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {!percentileHasEnoughTotalMinutes && (
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--muted-foreground)",
                        marginTop: 12,
                      }}
                    >
                      Limited game time — percentile data requires {PERCENTILE_MIN_MINUTES}+ total minutes played ({stats.minutes ?? 0} mins)
                    </p>
                  )}
                </div>

                {!percentileHasEnoughTotalMinutes ? (
                  <div
                    style={{
                      padding: "2rem",
                      color: "var(--muted-foreground)",
                      fontSize: 14,
                      textAlign: "center",
                    }}
                  >
                    <p>Percentile rankings require {PERCENTILE_MIN_MINUTES}+ total minutes played.</p>
                  </div>
                ) : !peerHasData ? (
                  <div
                    style={{
                      padding: "2rem",
                      color: "var(--muted-foreground)",
                      fontSize: 14,
                      textAlign: "center",
                    }}
                  >
                    <p>No percentile row available for this role yet.</p>
                  </div>
                ) : viewMode === "pizza" ? (
                  <div style={{ marginBottom: 24 }}>
                    <PizzaChart
                      data={
                        peerQualified
                          ? isST
                            ? [
                                // Goalscoring (9)
                                {
                                  label:
                                    statMode === "per90" ? "Goals/90" : "Goals",
                                  percentile: pct(
                                    peerRating?.goals_per90_percentile,
                                    peerRating?.goals_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label: statMode === "per90" ? "xG/90" : "xG",
                                  percentile: pct(
                                    peerRating?.xg_per90_percentile,
                                    peerRating?.xg_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Shots/90" : "Shots",
                                  percentile: pct(
                                    peerRating?.shots_per90_percentile,
                                    peerRating?.shots_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label: "SoT%",
                                  percentile:
                                    peerRating?.shot_on_target_percentile ?? 0,
                                },
                                {
                                  label: "xG/shot",
                                  percentile:
                                    peerRating?.xg_per_shot_percentile ?? 0,
                                },
                                {
                                  label: "Conv%",
                                  percentile:
                                    peerRating?.shot_conversion_percentile ?? 0,
                                },
                                {
                                  label:
                                    statMode === "per90" ? "npxG/90" : "np xG",
                                  percentile: pct(
                                    peerRating?.np_xg_per90_percentile,
                                    peerRating?.np_xg_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "xGOT/90" : "xGOT",
                                  percentile: pct(
                                    peerRating?.xgot_per90_percentile,
                                    peerRating?.xg_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "BCM/90" : "BCM",
                                  percentile: pct(
                                    peerRating?.big_chances_missed_percentile,
                                    peerRating?.big_chances_missed_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                  inverted: true,
                                },
                                // Chance creation (4)
                                {
                                  label: statMode === "per90" ? "xA/90" : "xA",
                                  percentile: pct(
                                    peerRating?.xa_per90_percentile,
                                    peerRating?.xa_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Ast/90" : "Ast",
                                  percentile: pct(
                                    peerRating?.assists_per90_percentile,
                                    peerRating?.assists_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label: statMode === "per90" ? "KP/90" : "KP",
                                  percentile: pct(
                                    peerRating?.key_passes_per90_percentile,
                                    peerRating?.key_passes_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "BCC/90" : "BCC",
                                  percentile: pct(
                                    peerRating?.big_chances_created_percentile,
                                    peerRating?.big_chances_created_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                // Ball carrying (4)
                                {
                                  label: "Drb%",
                                  percentile:
                                    peerRating?.dribble_success_percentile ?? 0,
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Drb/90" : "Drb",
                                  percentile: pct(
                                    peerRating?.dribbles_per90_percentile,
                                    peerRating?.dribbles_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Tch/90" : "Tch",
                                  percentile: pct(
                                    peerRating?.touches_per90_percentile,
                                    peerRating?.touches_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label: "PossLoss",
                                  percentile:
                                    peerRating?.carrying_percentile ?? 0,
                                  inverted: true,
                                },
                                // Physical (4)
                                {
                                  label: "Air%",
                                  percentile:
                                    peerRating?.aerial_win_rate_percentile ?? 0,
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Air/90" : "Air",
                                  percentile: pct(
                                    peerRating?.aerials_per90_percentile,
                                    peerRating?.aerials_won_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Grd/90" : "Grd",
                                  percentile: pct(
                                    peerRating?.ground_duels_won_per90_percentile,
                                    peerRating?.ground_duels_won_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Cont/90" : "Cont",
                                  percentile: pct(
                                    peerRating?.total_contest_per90_percentile,
                                    peerRating?.total_contests_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                // Defending / Passing (4)
                                {
                                  label:
                                    statMode === "per90" ? "Rec/90" : "Rec",
                                  percentile: pct(
                                    peerRating?.ball_recoveries_per90_percentile,
                                    peerRating?.ball_recoveries_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Tkl/90" : "Tkl",
                                  percentile: pct(
                                    peerRating?.tackles_per90_percentile,
                                    peerRating?.tackles_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label:
                                    statMode === "per90" ? "Pass/90" : "Passes",
                                  percentile: pct(
                                    peerRating?.passes_completed_per90_percentile,
                                    peerRating?.passes_completed_raw_percentile,
                                    statMode,
                                    peerQualified,
                                  ),
                                },
                                {
                                  label: "Pass%",
                                  percentile:
                                    peerRating?.passing_accuracy_percentile ??
                                    0,
                                },
                              ]
                            : isCAM
                              ? [
                                  // Chance creation (6)
                                  {
                                    label:
                                      statMode === "per90" ? "xA/90" : "xA",
                                    percentile: pct(
                                      peerRating?.xa_per90_percentile,
                                      peerRating?.xa_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Ast/90" : "Ast",
                                    percentile: pct(
                                      peerRating?.assists_per90_percentile,
                                      peerRating?.assists_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label: "xG+xA",
                                    percentile: pct(
                                      peerRating?.xg_plus_xa_percentile,
                                      peerRating?.xg_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "KP/90" : "KP",
                                    percentile: pct(
                                      peerRating?.key_passes_per90_percentile,
                                      peerRating?.key_passes_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "BCC/90" : "BCC",
                                    percentile: pct(
                                      peerRating?.big_chances_created_percentile,
                                      peerRating?.big_chances_created_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Crs/90" : "Crs",
                                    percentile: pct(
                                      peerRating?.accurate_cross_per90_percentile,
                                      peerRating?.accurate_cross_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  // Goal threat (5)
                                  {
                                    label:
                                      statMode === "per90"
                                        ? "Goals/90"
                                        : "Goals",
                                    percentile: pct(
                                      peerRating?.goals_per90_percentile,
                                      peerRating?.goals_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "xG/90" : "xG",
                                    percentile: pct(
                                      peerRating?.xg_per90_percentile,
                                      peerRating?.xg_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90"
                                        ? "Shots/90"
                                        : "Shots",
                                    percentile: pct(
                                      peerRating?.shots_per90_percentile,
                                      peerRating?.shots_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label: "SoT%",
                                    percentile:
                                      peerRating?.shot_on_target_percentile ??
                                      0,
                                  },
                                  {
                                    label:
                                      statMode === "per90"
                                        ? "npxG/90"
                                        : "np xG",
                                    percentile: pct(
                                      peerRating?.np_xg_per90_percentile,
                                      peerRating?.np_xg_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  // Ball carrying (4)
                                  {
                                    label: "Drb%",
                                    percentile:
                                      peerRating?.dribble_success_percentile ??
                                      0,
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Drb/90" : "Drb",
                                    percentile: pct(
                                      peerRating?.dribbles_per90_percentile,
                                      peerRating?.dribbles_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Tch/90" : "Tch",
                                    percentile: pct(
                                      peerRating?.touches_per90_percentile,
                                      peerRating?.touches_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label: "PossLoss",
                                    percentile:
                                      peerRating?.carrying_percentile ?? 0,
                                    inverted: true,
                                  },
                                  // Physical (3)
                                  {
                                    label: "Air%",
                                    percentile:
                                      peerRating?.aerial_win_rate_percentile ?? 0,
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Grd/90" : "Grd",
                                    percentile: pct(
                                      peerRating?.ground_duels_won_per90_percentile,
                                      peerRating?.ground_duels_won_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Cont/90" : "Cont",
                                    percentile: pct(
                                      peerRating?.total_contest_per90_percentile,
                                      peerRating?.total_contests_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  // Defending (4)
                                  {
                                    label:
                                      statMode === "per90" ? "Rec/90" : "Rec",
                                    percentile: pct(
                                      peerRating?.ball_recoveries_per90_percentile,
                                      peerRating?.ball_recoveries_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Tkl/90" : "Tkl",
                                    percentile: pct(
                                      peerRating?.tackles_per90_percentile,
                                      peerRating?.tackles_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "Int/90" : "Int",
                                    percentile: pct(
                                      peerRating?.interceptions_per90_percentile,
                                      peerRating?.interceptions_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label: "FC/90",
                                    percentile:
                                      peerRating?.pressing_percentile ?? 0,
                                    inverted: true,
                                  },
                                  // Passing (3)
                                  {
                                    label:
                                      statMode === "per90"
                                        ? "Pass/90"
                                        : "Passes",
                                    percentile: pct(
                                      peerRating?.passes_completed_per90_percentile,
                                      peerRating?.passes_completed_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                  {
                                    label: "Pass%",
                                    percentile:
                                      peerRating?.passing_accuracy_percentile ??
                                      0,
                                  },
                                  {
                                    label:
                                      statMode === "per90" ? "LB/90" : "LB",
                                    percentile: pct(
                                      peerRating?.accurate_long_balls_per90_percentile,
                                      peerRating?.accurate_long_balls_raw_percentile,
                                      statMode,
                                      peerQualified,
                                    ),
                                  },
                                ]
                              : isWinger
                                ? [
                                    // Chance creation (5)
                                    {
                                      label:
                                        statMode === "per90" ? "xA/90" : "xA",
                                      percentile: pct(
                                        peerRating?.xa_per90_percentile,
                                        peerRating?.xa_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Ast/90" : "Ast",
                                      percentile: pct(
                                        peerRating?.assists_per90_percentile,
                                        peerRating?.assists_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "KP/90" : "KP",
                                      percentile: pct(
                                        peerRating?.key_passes_per90_percentile,
                                        peerRating?.key_passes_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "BCC/90" : "BCC",
                                      percentile: pct(
                                        peerRating?.big_chances_created_percentile,
                                        peerRating?.big_chances_created_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Crs/90" : "Crs",
                                      percentile: pct(
                                        peerRating?.accurate_cross_per90_percentile,
                                        peerRating?.accurate_cross_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    // Goal threat (5)
                                    {
                                      label:
                                        statMode === "per90"
                                          ? "Goals/90"
                                          : "Goals",
                                      percentile: pct(
                                        peerRating?.goals_per90_percentile,
                                        peerRating?.goals_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "xG/90" : "xG",
                                      percentile: pct(
                                        peerRating?.xg_per90_percentile,
                                        peerRating?.xg_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90"
                                          ? "Shots/90"
                                          : "Shots",
                                      percentile: pct(
                                        peerRating?.shots_per90_percentile,
                                        peerRating?.shots_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label: "SoT%",
                                      percentile:
                                        peerRating?.shot_on_target_percentile ??
                                        0,
                                    },
                                    {
                                      label: "Conv%",
                                      percentile:
                                        peerRating?.shot_conversion_percentile ??
                                        0,
                                    },
                                    // Ball carrying (5)
                                    {
                                      label: "Drb%",
                                      percentile:
                                        peerRating?.dribble_success_percentile ??
                                        0,
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Drb/90" : "Drb",
                                      percentile: pct(
                                        peerRating?.dribbles_per90_percentile,
                                        peerRating?.dribbles_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Fw/90" : "Fw",
                                      percentile: pct(
                                        peerRating?.fouls_won_per90_percentile,
                                        peerRating?.fouls_won_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Tch/90" : "Tch",
                                      percentile: pct(
                                        peerRating?.touches_per90_percentile,
                                        peerRating?.touches_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label: "PossLoss",
                                      percentile:
                                        peerRating?.carrying_percentile ?? 0,
                                      inverted: true,
                                    },
                                    // Physical (3)
                                    {
                                      label:
                                        statMode === "per90" ? "Air/90" : "Air",
                                      percentile: pct(
                                        peerRating?.aerials_per90_percentile,
                                        peerRating?.aerials_won_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Grd/90" : "Grd",
                                      percentile: pct(
                                        peerRating?.ground_duels_won_per90_percentile,
                                        peerRating?.ground_duels_won_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90"
                                          ? "Cont/90"
                                          : "Cont",
                                      percentile: pct(
                                        peerRating?.total_contest_per90_percentile,
                                        peerRating?.total_contests_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    // Defending (4)
                                    {
                                      label:
                                        statMode === "per90" ? "Rec/90" : "Rec",
                                      percentile: pct(
                                        peerRating?.ball_recoveries_per90_percentile,
                                        peerRating?.ball_recoveries_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Tkl/90" : "Tkl",
                                      percentile: pct(
                                        peerRating?.tackles_per90_percentile,
                                        peerRating?.tackles_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label:
                                        statMode === "per90" ? "Int/90" : "Int",
                                      percentile: pct(
                                        peerRating?.interceptions_per90_percentile,
                                        peerRating?.interceptions_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label: "FC/90",
                                      percentile:
                                        peerRating?.pressing_percentile ?? 0,
                                      inverted: true,
                                    },
                                    // Passing (3)
                                    {
                                      label:
                                        statMode === "per90"
                                          ? "Pass/90"
                                          : "Passes",
                                      percentile: pct(
                                        peerRating?.passes_completed_per90_percentile,
                                        peerRating?.passes_completed_raw_percentile,
                                        statMode,
                                        peerQualified,
                                      ),
                                    },
                                    {
                                      label: "Pass%",
                                      percentile:
                                        peerRating?.passing_accuracy_percentile ??
                                        0,
                                    },
                                    ...(peerRating?.xg_chain_per90_percentile !=
                                    null
                                      ? [
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "xChain/90"
                                                : "xChain",
                                            percentile: pct(
                                              peerRating?.xg_chain_per90_percentile,
                                              peerRating?.xg_chain_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                        ]
                                      : [
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "LB/90"
                                                : "LB",
                                            percentile: pct(
                                              peerRating?.accurate_long_balls_per90_percentile,
                                              peerRating?.accurate_long_balls_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                        ]),
                                  ]
                                : isDefensiveWinger
                                  ? [
                                      // Chance creation (4)
                                      {
                                        label:
                                          statMode === "per90" ? "xA/90" : "xA",
                                        percentile: pct(
                                          peerRating?.xa_per90_percentile,
                                          peerRating?.xa_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Ast/90"
                                            : "Ast",
                                        percentile: pct(
                                          peerRating?.assists_per90_percentile,
                                          peerRating?.assists_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90" ? "KP/90" : "KP",
                                        percentile: pct(
                                          peerRating?.key_passes_per90_percentile,
                                          peerRating?.key_passes_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Crs/90"
                                            : "Crs",
                                        percentile: pct(
                                          peerRating?.accurate_cross_per90_percentile,
                                          peerRating?.accurate_cross_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      // Goal threat (3)
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Goals/90"
                                            : "Goals",
                                        percentile: pct(
                                          peerRating?.goals_per90_percentile,
                                          peerRating?.goals_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90" ? "xG/90" : "xG",
                                        percentile: pct(
                                          peerRating?.xg_per90_percentile,
                                          peerRating?.xg_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Shots/90"
                                            : "Shots",
                                        percentile: pct(
                                          peerRating?.shots_per90_percentile,
                                          peerRating?.shots_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      // Ball carrying (4)
                                      {
                                        label: "Drb%",
                                        percentile:
                                          peerRating?.dribble_success_percentile ??
                                          0,
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Drb/90"
                                            : "Drb",
                                        percentile: pct(
                                          peerRating?.dribbles_per90_percentile,
                                          peerRating?.dribbles_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Tch/90"
                                            : "Tch",
                                        percentile: pct(
                                          peerRating?.touches_per90_percentile,
                                          peerRating?.touches_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label: "PossLoss",
                                        percentile:
                                          peerRating?.carrying_percentile ?? 0,
                                        inverted: true,
                                      },
                                      // Physical (4)
                                      {
                                        label: "Air%",
                                        percentile:
                                          peerRating?.aerial_win_rate_percentile ?? 0,
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Air/90"
                                            : "Air",
                                        percentile: pct(
                                          peerRating?.aerials_per90_percentile,
                                          peerRating?.aerials_won_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Grd/90"
                                            : "Grd",
                                        percentile: pct(
                                          peerRating?.ground_duels_won_per90_percentile,
                                          peerRating?.ground_duels_won_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Cont/90"
                                            : "Cont",
                                        percentile: pct(
                                          peerRating?.total_contest_per90_percentile,
                                          peerRating?.total_contests_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      // Defending (4)
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Rec/90"
                                            : "Rec",
                                        percentile: pct(
                                          peerRating?.ball_recoveries_per90_percentile,
                                          peerRating?.ball_recoveries_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Tkl/90"
                                            : "Tkl",
                                        percentile: pct(
                                          peerRating?.tackles_per90_percentile,
                                          peerRating?.tackles_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Int/90"
                                            : "Int",
                                        percentile: pct(
                                          peerRating?.interceptions_per90_percentile,
                                          peerRating?.interceptions_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label: "FC/90",
                                        percentile:
                                          peerRating?.pressing_percentile ?? 0,
                                        inverted: true,
                                      },
                                      // Passing (6)
                                      {
                                        label:
                                          statMode === "per90"
                                            ? "Pass/90"
                                            : "Passes",
                                        percentile: pct(
                                          peerRating?.passes_completed_per90_percentile,
                                          peerRating?.passes_completed_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label: "Pass%",
                                        percentile:
                                          peerRating?.passing_accuracy_percentile ??
                                          0,
                                      },
                                      {
                                        label:
                                          statMode === "per90" ? "LB/90" : "LB",
                                        percentile: pct(
                                          peerRating?.accurate_long_balls_per90_percentile,
                                          peerRating?.accurate_long_balls_raw_percentile,
                                          statMode,
                                          peerQualified,
                                        ),
                                      },
                                      {
                                        label: "LB%",
                                        percentile:
                                          peerRating?.long_ball_accuracy_percentile ??
                                          0,
                                      },
                                      ...(peerRating?.xg_chain_per90_percentile !=
                                      null
                                        ? [
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "xChain/90"
                                                  : "xChain",
                                              percentile: pct(
                                                peerRating?.xg_chain_per90_percentile,
                                                peerRating?.xg_chain_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                          ]
                                        : []),
                                      ...(peerRating?.xg_buildup_per90_percentile !=
                                      null
                                        ? [
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "xBuildup/90"
                                                  : "xBuildup",
                                              percentile: pct(
                                                peerRating?.xg_buildup_per90_percentile,
                                                peerRating?.xg_buildup_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                          ]
                                        : []),
                                    ]
                                  : isCM
                                    ? [
                                        // Chance creation (5)
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "xA/90"
                                              : "xA",
                                          percentile: pct(
                                            peerRating?.xa_per90_percentile,
                                            peerRating?.xa_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Ast/90"
                                              : "Ast",
                                          percentile: pct(
                                            peerRating?.assists_per90_percentile,
                                            peerRating?.assists_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label: "xG+xA",
                                          percentile: pct(
                                            peerRating?.xg_plus_xa_percentile,
                                            peerRating?.xg_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "KP/90"
                                              : "KP",
                                          percentile: pct(
                                            peerRating?.key_passes_per90_percentile,
                                            peerRating?.key_passes_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "BCC/90"
                                              : "BCC",
                                          percentile: pct(
                                            peerRating?.big_chances_created_percentile,
                                            peerRating?.big_chances_created_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        // Goal threat (4)
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Goals/90"
                                              : "Goals",
                                          percentile: pct(
                                            peerRating?.goals_per90_percentile,
                                            peerRating?.goals_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "xG/90"
                                              : "xG",
                                          percentile: pct(
                                            peerRating?.xg_per90_percentile,
                                            peerRating?.xg_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Shots/90"
                                              : "Shots",
                                          percentile: pct(
                                            peerRating?.shots_per90_percentile,
                                            peerRating?.shots_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label: "SoT%",
                                          percentile:
                                            peerRating?.shot_on_target_percentile ??
                                            0,
                                        },
                                        // Ball carrying (4)
                                        {
                                          label: "Drb%",
                                          percentile:
                                            peerRating?.dribble_success_percentile ??
                                            0,
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Drb/90"
                                              : "Drb",
                                          percentile: pct(
                                            peerRating?.dribbles_per90_percentile,
                                            peerRating?.dribbles_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Tch/90"
                                              : "Tch",
                                          percentile: pct(
                                            peerRating?.touches_per90_percentile,
                                            peerRating?.touches_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Fw/90"
                                              : "Fw",
                                          percentile: pct(
                                            peerRating?.fouls_won_per90_percentile,
                                            peerRating?.fouls_won_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        // Physical (3)
                                        {
                                          label: "Air%",
                                          percentile:
                                            peerRating?.aerial_win_rate_percentile ??
                                            0,
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Grd/90"
                                              : "Grd",
                                          percentile: pct(
                                            peerRating?.ground_duels_won_per90_percentile,
                                            peerRating?.ground_duels_won_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Cont/90"
                                              : "Cont",
                                          percentile: pct(
                                            peerRating?.total_contest_per90_percentile,
                                            peerRating?.total_contests_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        // Defending (4)
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Rec/90"
                                              : "Rec",
                                          percentile: pct(
                                            peerRating?.ball_recoveries_per90_percentile,
                                            peerRating?.ball_recoveries_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Tkl/90"
                                              : "Tkl",
                                          percentile: pct(
                                            peerRating?.tackles_per90_percentile,
                                            peerRating?.tackles_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Int/90"
                                              : "Int",
                                          percentile: pct(
                                            peerRating?.interceptions_per90_percentile,
                                            peerRating?.interceptions_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label: "FC/90",
                                          percentile:
                                            peerRating?.pressing_percentile ??
                                            0,
                                          inverted: true,
                                        },
                                        // Passing (5)
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "Pass/90"
                                              : "Passes",
                                          percentile: pct(
                                            peerRating?.passes_completed_per90_percentile,
                                            peerRating?.passes_completed_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        {
                                          label: "Pass%",
                                          percentile:
                                            peerRating?.passing_accuracy_percentile ??
                                            0,
                                        },
                                        {
                                          label:
                                            statMode === "per90"
                                              ? "LB/90"
                                              : "LB",
                                          percentile: pct(
                                            peerRating?.accurate_long_balls_per90_percentile,
                                            peerRating?.accurate_long_balls_raw_percentile,
                                            statMode,
                                            peerQualified,
                                          ),
                                        },
                                        ...(peerRating?.xg_chain_per90_percentile !=
                                        null
                                          ? [
                                              {
                                                label:
                                                  statMode === "per90"
                                                    ? "xChain/90"
                                                    : "xChain",
                                                percentile: pct(
                                                  peerRating?.xg_chain_per90_percentile,
                                                  peerRating?.xg_chain_raw_percentile,
                                                  statMode,
                                                  peerQualified,
                                                ),
                                              },
                                            ]
                                          : []),
                                        ...(peerRating?.xg_buildup_per90_percentile !=
                                        null
                                          ? [
                                              {
                                                label:
                                                  statMode === "per90"
                                                    ? "xBuildup/90"
                                                    : "xBuildup",
                                                percentile: pct(
                                                  peerRating?.xg_buildup_per90_percentile,
                                                  peerRating?.xg_buildup_raw_percentile,
                                                  statMode,
                                                  peerQualified,
                                                ),
                                              },
                                            ]
                                          : []),
                                      ]
                                    : isCDM
                                      ? [
                                          // Defending (5)
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Rec/90"
                                                : "Rec",
                                            percentile: pct(
                                              peerRating?.ball_recoveries_per90_percentile,
                                              peerRating?.ball_recoveries_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Tkl/90"
                                                : "Tkl",
                                            percentile: pct(
                                              peerRating?.tackles_per90_percentile,
                                              peerRating?.tackles_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Int/90"
                                                : "Int",
                                            percentile: pct(
                                              peerRating?.interceptions_per90_percentile,
                                              peerRating?.interceptions_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "FC/90",
                                            percentile:
                                              peerRating?.pressing_percentile ??
                                              0,
                                            inverted: true,
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Fw/90"
                                                : "Fw",
                                            percentile: pct(
                                              peerRating?.fouls_won_per90_percentile,
                                              peerRating?.fouls_won_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          // Physical (5)
                                          {
                                            label: "Air%",
                                            percentile:
                                              peerRating?.aerial_win_rate_percentile ??
                                              0,
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Air/90"
                                                : "Air",
                                            percentile: pct(
                                              peerRating?.aerials_per90_percentile,
                                              peerRating?.aerials_won_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "Grd%",
                                            percentile:
                                              peerRating?.ground_duel_win_rate_percentile ??
                                              0,
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Grd/90"
                                                : "Grd",
                                            percentile: pct(
                                              peerRating?.ground_duels_won_per90_percentile,
                                              peerRating?.ground_duels_won_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Cont/90"
                                                : "Cont",
                                            percentile: pct(
                                              peerRating?.total_contest_per90_percentile,
                                              peerRating?.total_contests_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          // Ball carrying (3)
                                          {
                                            label: "Drb%",
                                            percentile:
                                              peerRating?.dribble_success_percentile ??
                                              0,
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Tch/90"
                                                : "Tch",
                                            percentile: pct(
                                              peerRating?.touches_per90_percentile,
                                              peerRating?.touches_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "PossLoss",
                                            percentile:
                                              peerRating?.carrying_percentile ??
                                              0,
                                            inverted: true,
                                          },
                                          // Chance creation (3)
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "xA/90"
                                                : "xA",
                                            percentile: pct(
                                              peerRating?.xa_per90_percentile,
                                              peerRating?.xa_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "xG+xA",
                                            percentile: pct(
                                              peerRating?.xg_plus_xa_percentile,
                                              peerRating?.xg_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "KP/90"
                                                : "KP",
                                            percentile: pct(
                                              peerRating?.key_passes_per90_percentile,
                                              peerRating?.key_passes_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          // Passing (6)
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "Pass/90"
                                                : "Passes",
                                            percentile: pct(
                                              peerRating?.passes_completed_per90_percentile,
                                              peerRating?.passes_completed_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "Pass%",
                                            percentile:
                                              peerRating?.passing_accuracy_percentile ??
                                              0,
                                          },
                                          {
                                            label:
                                              statMode === "per90"
                                                ? "LB/90"
                                                : "LB",
                                            percentile: pct(
                                              peerRating?.accurate_long_balls_per90_percentile,
                                              peerRating?.accurate_long_balls_raw_percentile,
                                              statMode,
                                              peerQualified,
                                            ),
                                          },
                                          {
                                            label: "LB%",
                                            percentile:
                                              peerRating?.long_ball_accuracy_percentile ??
                                              0,
                                          },
                                          ...(peerRating?.xg_chain_per90_percentile !=
                                          null
                                            ? [
                                                {
                                                  label:
                                                    statMode === "per90"
                                                      ? "xChain/90"
                                                      : "xChain",
                                                  percentile: pct(
                                                    peerRating?.xg_chain_per90_percentile,
                                                    peerRating?.xg_chain_raw_percentile,
                                                    statMode,
                                                    peerQualified,
                                                  ),
                                                },
                                              ]
                                            : []),
                                          ...(peerRating?.xg_buildup_per90_percentile !=
                                          null
                                            ? [
                                                {
                                                  label:
                                                    statMode === "per90"
                                                      ? "xBuildup/90"
                                                      : "xBuildup",
                                                  percentile: pct(
                                                    peerRating?.xg_buildup_per90_percentile,
                                                    peerRating?.xg_buildup_raw_percentile,
                                                    statMode,
                                                    peerQualified,
                                                  ),
                                                },
                                              ]
                                            : []),
                                        ]
                                      : isDefender
                                        ? [
                                            // Physical (5)
                                            {
                                              label: "Air%",
                                              percentile:
                                                peerRating?.aerial_win_rate_percentile ??
                                                0,
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Air/90"
                                                  : "Air",
                                              percentile: pct(
                                                peerRating?.aerials_per90_percentile,
                                                peerRating?.aerials_won_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label: "Grd%",
                                              percentile:
                                                peerRating?.ground_duel_win_rate_percentile ??
                                                0,
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Grd/90"
                                                  : "Grd",
                                              percentile: pct(
                                                peerRating?.ground_duels_won_per90_percentile,
                                                peerRating?.ground_duels_won_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Cont/90"
                                                  : "Cont",
                                              percentile: pct(
                                                peerRating?.total_contest_per90_percentile,
                                                peerRating?.total_contests_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            // Defending (4)
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Rec/90"
                                                  : "Rec",
                                              percentile: pct(
                                                peerRating?.ball_recoveries_per90_percentile,
                                                peerRating?.ball_recoveries_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Tkl/90"
                                                  : "Tkl",
                                              percentile: pct(
                                                peerRating?.tackles_per90_percentile,
                                                peerRating?.tackles_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Int/90"
                                                  : "Int",
                                              percentile: pct(
                                                peerRating?.interceptions_per90_percentile,
                                                peerRating?.interceptions_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label: "FC/90",
                                              percentile:
                                                peerRating?.pressing_percentile ??
                                                0,
                                              inverted: true,
                                            },
                                            // Ball carrying (3)
                                            {
                                              label: "Drb%",
                                              percentile:
                                                peerRating?.dribble_success_percentile ??
                                                0,
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Tch/90"
                                                  : "Tch",
                                              percentile: pct(
                                                peerRating?.touches_per90_percentile,
                                                peerRating?.touches_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label: "PossLoss",
                                              percentile:
                                                peerRating?.carrying_percentile ??
                                                0,
                                              inverted: true,
                                            },
                                            // Chance creation (4)
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "xA/90"
                                                  : "xA",
                                              percentile: pct(
                                                peerRating?.xa_per90_percentile,
                                                peerRating?.xa_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Ast/90"
                                                  : "Ast",
                                              percentile: pct(
                                                peerRating?.assists_per90_percentile,
                                                peerRating?.assists_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Crs/90"
                                                  : "Crs",
                                              percentile: pct(
                                                peerRating?.accurate_cross_per90_percentile,
                                                peerRating?.accurate_cross_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "KP/90"
                                                  : "KP",
                                              percentile: pct(
                                                peerRating?.key_passes_per90_percentile,
                                                peerRating?.key_passes_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            // Passing (6)
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "Pass/90"
                                                  : "Passes",
                                              percentile: pct(
                                                peerRating?.passes_completed_per90_percentile,
                                                peerRating?.passes_completed_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label: "Pass%",
                                              percentile:
                                                peerRating?.passing_accuracy_percentile ??
                                                0,
                                            },
                                            {
                                              label:
                                                statMode === "per90"
                                                  ? "LB/90"
                                                  : "LB",
                                              percentile: pct(
                                                peerRating?.accurate_long_balls_per90_percentile,
                                                peerRating?.accurate_long_balls_raw_percentile,
                                                statMode,
                                                peerQualified,
                                              ),
                                            },
                                            {
                                              label: "LB%",
                                              percentile:
                                                peerRating?.long_ball_accuracy_percentile ??
                                                0,
                                            },
                                            ...(peerRating?.xg_chain_per90_percentile !=
                                            null
                                              ? [
                                                  {
                                                    label:
                                                      statMode === "per90"
                                                        ? "xChain/90"
                                                        : "xChain",
                                                    percentile: pct(
                                                      peerRating?.xg_chain_per90_percentile,
                                                      peerRating?.xg_chain_raw_percentile,
                                                      statMode,
                                                      peerQualified,
                                                    ),
                                                  },
                                                ]
                                              : []),
                                            ...(peerRating?.xg_buildup_per90_percentile !=
                                            null
                                              ? [
                                                  {
                                                    label:
                                                      statMode === "per90"
                                                        ? "xBuildup/90"
                                                        : "xBuildup",
                                                    percentile: pct(
                                                      peerRating?.xg_buildup_per90_percentile,
                                                      peerRating?.xg_buildup_raw_percentile,
                                                      statMode,
                                                      peerQualified,
                                                    ),
                                                  },
                                                ]
                                              : []),
                                          ]
                                        : []
                          : []
                      }
                    />
                  </div>
                ) : isST ? (
                  <>
                    {/* Goalscoring */}
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goalscoring
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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

                    {/* CAM — Goal Threat */}
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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

                    {/* CAM — Physical Duels */}
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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

                    {/* CM — Goal Threat */}
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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

                    {/* CM — Physical Duels */}
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Physical duels
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Defending
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Ball carrying
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Passing
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                    <div style={{ marginBottom: 32 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Chance creation
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Goal threat
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr",
                          gap: "2px",
                        }}
                      >
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
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 10,
                    color: "var(--muted-foreground)",
                  }}
                >
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
                  <span style={{ fontWeight: 500 }}>Know Ball</span>
                </div>
              </CardContent>
            </Card>

            {/* ── Peer Comparison ──────────────────────────────────────────── */}
            <Card className="mt-4">
              <CardContent className="p-6">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted-foreground)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Peer comparison
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
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
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--muted-foreground)",
                      padding: "1rem 0",
                    }}
                  >
                    No peer comparison data available.
                  </div>
                ) : (activePeerRating.rated_minutes ?? 0) < activePeerMinMinutes ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--muted-foreground)",
                      padding: "1rem 0",
                    }}
                  >
                    Peer comparison requires {activePeerMinMinutes}+ minutes rated as{" "}
                    {POSITION_LABELS[activePeerRating.position ?? player.position ?? "ST"] ??
                      activePeerRating.position ??
                      "Striker"}
                    . Currently {activePeerRating.rated_minutes ?? 0} mins.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 16,
                    }}
                  >
                    {/* Model score */}
                    {activePeerRating.model_score != null && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 16px",
                          background: "var(--muted)",
                          borderRadius: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--muted-foreground)",
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                            }}
                          >
                            Know Ball Score
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--muted-foreground)",
                              maxWidth: 320,
                            }}
                          >
                            Overall season score for this role.
                            Use percentile ranking for peer context.
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 28,
                            fontWeight: 700,
                            color:
                              Number(activePeerRating.model_score) >= 60
                                ? "#1d9e75"
                                : Number(activePeerRating.model_score) >= 45
                                  ? "#ef9f27"
                                  : "#e24b4a",
                            flexShrink: 0,
                            marginLeft: 16,
                          }}
                        >
                          {Number(activePeerRating.model_score).toFixed(2)}
                        </span>
                      </div>
                    )}
                    {/* Good match rate & high impact rate */}
                    {(activePeerRating.consistency_score != null ||
                      activePeerRating.impact_rate != null) && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          padding: "14px 16px",
                          background: "var(--muted)",
                          borderRadius: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--muted-foreground)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Match Profile
                        </div>

                        {/* Good match rate row — low=20, high=70: below 20% is red, above 70% is green */}
                        {activePeerRating.consistency_score != null &&
                          (() => {
                            const val = Number(
                              activePeerRating.consistency_score,
                            );
                            const filled = val / 10; // continuous fill (0–10)
                            const labelColor = rateColor(val, 20, 70);
                            return (
                              <div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    marginBottom: 4,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "var(--foreground)",
                                      fontWeight: 500,
                                    }}
                                  >
                                    Good Performance Rate
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: labelColor,
                                    }}
                                  >
                                    {val.toFixed(0)}%
                                  </span>
                                </div>
                                <div style={{ display: "flex", gap: 2 }}>
                                  {Array.from({ length: 10 }, (_, i) => {
                                    const segMid = (i + 0.5) * 10; // midpoint % of this segment
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
                                          height: 6,
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

                        {/* High impact rate row — low=5, high=35: below 5% is red, above 35% is green */}
                        {activePeerRating.impact_rate != null &&
                          (() => {
                            const val = Number(activePeerRating.impact_rate);
                            const filled = val / 10;
                            const labelColor = rateColor(val, 5, 35);
                            return (
                              <div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    marginBottom: 4,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "var(--foreground)",
                                      fontWeight: 500,
                                    }}
                                  >
                                    Elite Performance Rate
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: labelColor,
                                    }}
                                  >
                                    {val.toFixed(0)}%
                                  </span>
                                </div>
                                <div style={{ display: "flex", gap: 2 }}>
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
                                          height: 6,
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

                        {/* Explanation */}
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted-foreground)",
                            marginTop: 4,
                            lineHeight: 1.5,
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 600,
                              color: "var(--foreground)",
                            }}
                          >
                            Good Performance Rate
                          </span>{" "}
                          = share of rated matches with a good performance.{" "}
                          <span
                            style={{
                              fontWeight: 600,
                              color: "var(--foreground)",
                            }}
                          >
                            Elite Performance Rate
                          </span>{" "}
                          = share of rated matches with an elite performance.
                          These are season rates, not peer rankings.
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                        margin: 0,
                      }}
                    >
                      Percentile ranks show how this player compares to{" "}
                      {POSITION_LABELS[activePeerRating.position ?? "ST"] ?? activePeerRating.position ?? "Strikers"}{" "}
                      in the same league and season with {activePeerMinMinutes}+ rated minutes.{" "}
                      99 = top 1%.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {(
                        (isWinger || isDefensiveWinger
                          ? [
                              {
                                label: "Overall rating",
                                value: activePeerRating.overall_percentile,
                              },
                              {
                                label: "Productive Dribbling",
                                value: activePeerRating.productive_dribbling_percentile,
                              },
                              {
                                label: "Chance Creation",
                                value: activePeerRating.chance_creation_percentile,
                              },
                              {
                                label: "Goal Contribution",
                                value: activePeerRating.goal_contribution_percentile,
                              },
                              {
                                label: "Carrying",
                                value: activePeerRating.carrying_percentile,
                              },
                              {
                                label: "Shot Generation",
                                value: activePeerRating.shot_generation_percentile,
                              },
                              {
                                label: "Defensive",
                                value: activePeerRating.defensive_percentile,
                              },
                              {
                                label: "Presence",
                                value: activePeerRating.presence_percentile,
                              },
                            ]
                          : isCAM
                          ? [
                              {
                                label: "Overall rating",
                                value: activePeerRating.overall_percentile,
                              },
                              {
                                label: "Chance Creation",
                                value: activePeerRating.chance_creation_percentile,
                              },
                              {
                                label: "Goal Threat",
                                value: activePeerRating.goal_threat_percentile,
                              },
                              {
                                label: "Team Function",
                                value: activePeerRating.team_function_percentile,
                              },
                              {
                                label: "Carrying",
                                value: activePeerRating.carrying_percentile,
                              },
                              {
                                label: "Defensive",
                                value: activePeerRating.defensive_percentile,
                              },
                            ]
                          : isCM
                          ? [
                              {
                                label: "Overall rating",
                                value: activePeerRating.overall_percentile,
                              },
                              {
                                label: "Volume Passing",
                                value: activePeerRating.volume_passing_percentile,
                              },
                              {
                                label: "Carrying",
                                value: activePeerRating.carrying_percentile,
                              },
                              {
                                label: "Chance Creation",
                                value: activePeerRating.chance_creation_percentile,
                              },
                              {
                                label: "Defensive",
                                value: activePeerRating.defensive_percentile,
                              },
                              {
                                label: "Goal Threat",
                                value: activePeerRating.goal_threat_percentile,
                              },
                            ]
                          : [
                              {
                                label: "Overall rating",
                                value: activePeerRating.overall_percentile,
                              },
                              {
                                label: "Finishing",
                                value: activePeerRating.finishing_percentile,
                              },
                              {
                                label: "Shot Generation",
                                value: activePeerRating.shot_generation_percentile,
                              },
                              {
                                label: "Chance Creation",
                                value: activePeerRating.chance_creation_percentile,
                              },
                              {
                                label: "Team Function",
                                value: activePeerRating.team_function_percentile,
                              },
                              {
                                label: "Carrying",
                                value: activePeerRating.carrying_percentile,
                              },
                              {
                                label: "Duels",
                                value: activePeerRating.duels_percentile,
                              },
                              {
                                label: "Defensive",
                                value: activePeerRating.defensive_percentile,
                              },
                              {
                                label: "Clinicality (vs xG)",
                                value:
                                  activePeerRating.xg_overperformance_percentile,
                              },
                            ]
                        ) as { label: string; value: number | null }[]
                      ).map(({ label, value }) => {
                        const pct = value ?? 0;
                        const barColor =
                          pct >= 70
                            ? "#1d9e75"
                            : pct >= 40
                              ? "#ef9f27"
                              : "#e24b4a";
                        return (
                          <div
                            key={label}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "160px 1fr 40px",
                              gap: 12,
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                color: "var(--muted-foreground)",
                              }}
                            >
                              {label}
                            </span>
                            <div
                              style={{
                                height: 6,
                                background: "var(--muted)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  height: "100%",
                                  width: `${pct}%`,
                                  background: barColor,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 500,
                                color: "var(--foreground)",
                                textAlign: "right",
                              }}
                            >
                              {value != null ? Math.round(value) : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          !isSupported && (
            <div
              style={{
                padding: "2rem",
                color: "var(--muted-foreground)",
                fontSize: 14,
              }}
            >
              Detailed stats coming soon for this position.
            </div>
          )
        )}

        {/* ── Shot Profile ─────────────────────────────────────────────────── */}
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

        {/* ── Rating History ───────────────────────────────────────────────── */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Rating History</CardTitle>
          </CardHeader>
          <CardContent>
            {ratings.length > 0 ? (
              <RatingLineChart ratings={ratings} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No rating data for this season.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
