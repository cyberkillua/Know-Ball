import type { PeerRating } from "./types";

export type PizzaMetric = {
  label: string;
  percentile: number;
  inverted?: boolean;
};

type StatMode = "per90" | "raw";

export type PositionFlags = {
  isST: boolean;
  isCAM: boolean;
  isWinger: boolean;
  isDefensiveWinger: boolean;
  isCM: boolean;
  isCDM: boolean;
  isDefender: boolean;
};

function pct(
  per90: number | null | undefined,
  raw: number | null | undefined,
  mode: StatMode,
  peerQualified: boolean,
): number {
  if (!peerQualified) return 0;
  const v = mode === "per90" ? per90 : raw;
  return v == null ? 0 : Number(v);
}

const m = (label: string, percentile: number, inverted?: boolean): PizzaMetric =>
  inverted ? { label, percentile, inverted: true } : { label, percentile };

const optional = <T,>(value: T | null | undefined, factory: () => PizzaMetric): PizzaMetric[] =>
  value != null ? [factory()] : [];

function getSTMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Goalscoring (9)
    m(mode === "per90" ? "Goals/90" : "Goals", pct(pr?.goals_per90_percentile, pr?.goals_raw_percentile, mode, q)),
    m(mode === "per90" ? "xG/90" : "xG", pct(pr?.xg_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "Shots/90" : "Shots", pct(pr?.shots_per90_percentile, pr?.shots_raw_percentile, mode, q)),
    m("SoT%", pr?.shot_on_target_percentile ?? 0),
    m("xG/shot", pr?.xg_per_shot_percentile ?? 0),
    m("Conv%", pr?.shot_conversion_percentile ?? 0),
    m(mode === "per90" ? "npxG/90" : "np xG", pct(pr?.np_xg_per90_percentile, pr?.np_xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "xGOT/90" : "xGOT", pct(pr?.xgot_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "BCM/90" : "BCM", pct(pr?.big_chances_missed_percentile, pr?.big_chances_missed_raw_percentile, mode, q), true),
    // Chance creation (4)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    m(mode === "per90" ? "BCC/90" : "BCC", pct(pr?.big_chances_created_percentile, pr?.big_chances_created_raw_percentile, mode, q)),
    // Ball carrying (4)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Drb/90" : "Drb", pct(pr?.dribbles_per90_percentile, pr?.dribbles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Physical (4)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Air/90" : "Air", pct(pr?.aerials_per90_percentile, pr?.aerials_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending / Passing (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
  ];
}

function getCAMMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Chance creation (6)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m("xG+xA", pct(pr?.xg_plus_xa_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    m(mode === "per90" ? "BCC/90" : "BCC", pct(pr?.big_chances_created_percentile, pr?.big_chances_created_raw_percentile, mode, q)),
    m(mode === "per90" ? "Crs/90" : "Crs", pct(pr?.accurate_cross_per90_percentile, pr?.accurate_cross_raw_percentile, mode, q)),
    // Goal threat (5)
    m(mode === "per90" ? "Goals/90" : "Goals", pct(pr?.goals_per90_percentile, pr?.goals_raw_percentile, mode, q)),
    m(mode === "per90" ? "xG/90" : "xG", pct(pr?.xg_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "Shots/90" : "Shots", pct(pr?.shots_per90_percentile, pr?.shots_raw_percentile, mode, q)),
    m("SoT%", pr?.shot_on_target_percentile ?? 0),
    m(mode === "per90" ? "npxG/90" : "np xG", pct(pr?.np_xg_per90_percentile, pr?.np_xg_raw_percentile, mode, q)),
    // Ball carrying (4)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Drb/90" : "Drb", pct(pr?.dribbles_per90_percentile, pr?.dribbles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Physical (3)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    // Passing (3)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q)),
  ];
}

function getWingerMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  const tail: PizzaMetric[] =
    pr?.xg_chain_per90_percentile != null
      ? [m(mode === "per90" ? "xChain/90" : "xChain", pct(pr?.xg_chain_per90_percentile, pr?.xg_chain_raw_percentile, mode, q))]
      : [m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q))];
  return [
    // Chance creation (5)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    m(mode === "per90" ? "BCC/90" : "BCC", pct(pr?.big_chances_created_percentile, pr?.big_chances_created_raw_percentile, mode, q)),
    m(mode === "per90" ? "Crs/90" : "Crs", pct(pr?.accurate_cross_per90_percentile, pr?.accurate_cross_raw_percentile, mode, q)),
    // Goal threat (5)
    m(mode === "per90" ? "Goals/90" : "Goals", pct(pr?.goals_per90_percentile, pr?.goals_raw_percentile, mode, q)),
    m(mode === "per90" ? "xG/90" : "xG", pct(pr?.xg_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "Shots/90" : "Shots", pct(pr?.shots_per90_percentile, pr?.shots_raw_percentile, mode, q)),
    m("SoT%", pr?.shot_on_target_percentile ?? 0),
    m("Conv%", pr?.shot_conversion_percentile ?? 0),
    // Ball carrying (5)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Drb/90" : "Drb", pct(pr?.dribbles_per90_percentile, pr?.dribbles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Fw/90" : "Fw", pct(pr?.fouls_won_per90_percentile, pr?.fouls_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Physical (3)
    m(mode === "per90" ? "Air/90" : "Air", pct(pr?.aerials_per90_percentile, pr?.aerials_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    // Passing (3)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    ...tail,
  ];
}

function getDefensiveWingerMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Chance creation (4)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    m(mode === "per90" ? "Crs/90" : "Crs", pct(pr?.accurate_cross_per90_percentile, pr?.accurate_cross_raw_percentile, mode, q)),
    // Goal threat (3)
    m(mode === "per90" ? "Goals/90" : "Goals", pct(pr?.goals_per90_percentile, pr?.goals_raw_percentile, mode, q)),
    m(mode === "per90" ? "xG/90" : "xG", pct(pr?.xg_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "Shots/90" : "Shots", pct(pr?.shots_per90_percentile, pr?.shots_raw_percentile, mode, q)),
    // Ball carrying (4)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Drb/90" : "Drb", pct(pr?.dribbles_per90_percentile, pr?.dribbles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Physical (4)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Air/90" : "Air", pct(pr?.aerials_per90_percentile, pr?.aerials_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    // Passing (6)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q)),
    m("LB%", pr?.long_ball_accuracy_percentile ?? 0),
    ...optional(pr?.xg_chain_per90_percentile, () =>
      m(mode === "per90" ? "xChain/90" : "xChain", pct(pr?.xg_chain_per90_percentile, pr?.xg_chain_raw_percentile, mode, q)),
    ),
    ...optional(pr?.xg_buildup_per90_percentile, () =>
      m(mode === "per90" ? "xBuildup/90" : "xBuildup", pct(pr?.xg_buildup_per90_percentile, pr?.xg_buildup_raw_percentile, mode, q)),
    ),
  ];
}

function getCMMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Chance creation (5)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m("xG+xA", pct(pr?.xg_plus_xa_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    m(mode === "per90" ? "BCC/90" : "BCC", pct(pr?.big_chances_created_percentile, pr?.big_chances_created_raw_percentile, mode, q)),
    // Goal threat (4)
    m(mode === "per90" ? "Goals/90" : "Goals", pct(pr?.goals_per90_percentile, pr?.goals_raw_percentile, mode, q)),
    m(mode === "per90" ? "xG/90" : "xG", pct(pr?.xg_per90_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "Shots/90" : "Shots", pct(pr?.shots_per90_percentile, pr?.shots_raw_percentile, mode, q)),
    m("SoT%", pr?.shot_on_target_percentile ?? 0),
    // Ball carrying (4)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Drb/90" : "Drb", pct(pr?.dribbles_per90_percentile, pr?.dribbles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m(mode === "per90" ? "Fw/90" : "Fw", pct(pr?.fouls_won_per90_percentile, pr?.fouls_won_raw_percentile, mode, q)),
    // Physical (3)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    // Passing (5)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q)),
    ...optional(pr?.xg_chain_per90_percentile, () =>
      m(mode === "per90" ? "xChain/90" : "xChain", pct(pr?.xg_chain_per90_percentile, pr?.xg_chain_raw_percentile, mode, q)),
    ),
    ...optional(pr?.xg_buildup_per90_percentile, () =>
      m(mode === "per90" ? "xBuildup/90" : "xBuildup", pct(pr?.xg_buildup_per90_percentile, pr?.xg_buildup_raw_percentile, mode, q)),
    ),
  ];
}

function getCDMMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Defending (5)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    m(mode === "per90" ? "Fw/90" : "Fw", pct(pr?.fouls_won_per90_percentile, pr?.fouls_won_raw_percentile, mode, q)),
    // Physical (5)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Air/90" : "Air", pct(pr?.aerials_per90_percentile, pr?.aerials_won_raw_percentile, mode, q)),
    m("Grd%", pr?.ground_duel_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Ball carrying (3)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Chance creation (3)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m("xG+xA", pct(pr?.xg_plus_xa_percentile, pr?.xg_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    // Passing (6)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q)),
    m("LB%", pr?.long_ball_accuracy_percentile ?? 0),
    ...optional(pr?.xg_chain_per90_percentile, () =>
      m(mode === "per90" ? "xChain/90" : "xChain", pct(pr?.xg_chain_per90_percentile, pr?.xg_chain_raw_percentile, mode, q)),
    ),
    ...optional(pr?.xg_buildup_per90_percentile, () =>
      m(mode === "per90" ? "xBuildup/90" : "xBuildup", pct(pr?.xg_buildup_per90_percentile, pr?.xg_buildup_raw_percentile, mode, q)),
    ),
  ];
}

function getDefenderMetrics(pr: PeerRating | null | undefined, mode: StatMode, q: boolean): PizzaMetric[] {
  return [
    // Physical (5)
    m("Air%", pr?.aerial_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Air/90" : "Air", pct(pr?.aerials_per90_percentile, pr?.aerials_won_raw_percentile, mode, q)),
    m("Grd%", pr?.ground_duel_win_rate_percentile ?? 0),
    m(mode === "per90" ? "Grd/90" : "Grd", pct(pr?.ground_duels_won_per90_percentile, pr?.ground_duels_won_raw_percentile, mode, q)),
    m(mode === "per90" ? "Cont/90" : "Cont", pct(pr?.total_contest_per90_percentile, pr?.total_contests_raw_percentile, mode, q)),
    // Defending (4)
    m(mode === "per90" ? "Rec/90" : "Rec", pct(pr?.ball_recoveries_per90_percentile, pr?.ball_recoveries_raw_percentile, mode, q)),
    m(mode === "per90" ? "Tkl/90" : "Tkl", pct(pr?.tackles_per90_percentile, pr?.tackles_raw_percentile, mode, q)),
    m(mode === "per90" ? "Int/90" : "Int", pct(pr?.interceptions_per90_percentile, pr?.interceptions_raw_percentile, mode, q)),
    m("FC/90", pr?.pressing_percentile ?? 0, true),
    // Ball carrying (3)
    m("Drb%", pr?.dribble_success_percentile ?? 0),
    m(mode === "per90" ? "Tch/90" : "Tch", pct(pr?.touches_per90_percentile, pr?.touches_raw_percentile, mode, q)),
    m("PossLoss", pr?.carrying_percentile ?? 0, true),
    // Chance creation (4)
    m(mode === "per90" ? "xA/90" : "xA", pct(pr?.xa_per90_percentile, pr?.xa_raw_percentile, mode, q)),
    m(mode === "per90" ? "Ast/90" : "Ast", pct(pr?.assists_per90_percentile, pr?.assists_raw_percentile, mode, q)),
    m(mode === "per90" ? "Crs/90" : "Crs", pct(pr?.accurate_cross_per90_percentile, pr?.accurate_cross_raw_percentile, mode, q)),
    m(mode === "per90" ? "KP/90" : "KP", pct(pr?.key_passes_per90_percentile, pr?.key_passes_raw_percentile, mode, q)),
    // Passing (6)
    m(mode === "per90" ? "Pass/90" : "Passes", pct(pr?.passes_completed_per90_percentile, pr?.passes_completed_raw_percentile, mode, q)),
    m("Pass%", pr?.passing_accuracy_percentile ?? 0),
    m(mode === "per90" ? "LB/90" : "LB", pct(pr?.accurate_long_balls_per90_percentile, pr?.accurate_long_balls_raw_percentile, mode, q)),
    m("LB%", pr?.long_ball_accuracy_percentile ?? 0),
    ...optional(pr?.xg_chain_per90_percentile, () =>
      m(mode === "per90" ? "xChain/90" : "xChain", pct(pr?.xg_chain_per90_percentile, pr?.xg_chain_raw_percentile, mode, q)),
    ),
    ...optional(pr?.xg_buildup_per90_percentile, () =>
      m(mode === "per90" ? "xBuildup/90" : "xBuildup", pct(pr?.xg_buildup_per90_percentile, pr?.xg_buildup_raw_percentile, mode, q)),
    ),
  ];
}

export function getPizzaMetrics(
  flags: PositionFlags,
  peerRating: PeerRating | null | undefined,
  statMode: StatMode,
  peerQualified: boolean,
): PizzaMetric[] {
  if (!peerQualified) return [];
  if (flags.isST) return getSTMetrics(peerRating, statMode, peerQualified);
  if (flags.isCAM) return getCAMMetrics(peerRating, statMode, peerQualified);
  if (flags.isWinger) return getWingerMetrics(peerRating, statMode, peerQualified);
  if (flags.isDefensiveWinger) return getDefensiveWingerMetrics(peerRating, statMode, peerQualified);
  if (flags.isCM) return getCMMetrics(peerRating, statMode, peerQualified);
  if (flags.isCDM) return getCDMMetrics(peerRating, statMode, peerQualified);
  if (flags.isDefender) return getDefenderMetrics(peerRating, statMode, peerQualified);
  return [];
}
