import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRoleArchetype(archetype: string | null | undefined) {
  const labels: Record<string, string> = {
    controller: "Controller",
    ball_winner: "Ball Winner",
    carrier: "Carrier",
    creator: "Creator",
    box_crasher: "Box Crasher",
    anchor_regista: "Anchor / Regista",
    destroyer: "Destroyer",
    shuttler_space_eater: "Shuttler / Space-Eater",
    box_to_box: "Box-to-Box",
    finisher: "Finisher",
    shot_generator: "Shot Generator",
    creator_forward: "Creator Forward",
    target_forward: "Target Forward",
    pressing_forward: "Pressing Forward",
    poacher: "Poacher / Fox in the Box",
    advanced_forward: "Advanced Forward",
    target_man: "Target Man",
    complete_forward: "Complete Forward",
    second_striker: "Second Striker",
    inside_forward: "Inside Forward",
    wide_creator: "Wide Creator",
    one_v_one_carrier: "1v1 Carrier",
    high_volume_winger: "High-Volume Winger",
    two_way_winger: "Two-Way Winger",
    inverted_winger_inside_forward: "Inverted Winger / Inside Forward",
    traditional_touchline_winger: "Traditional / Touchline Winger",
    wide_forward: "Wide Forward",
    one_v_one_touchline_winger: "1v1 Touchline Winger",
    goal_threat_10: "Goal-Threat 10",
    connector: "Connector",
    ball_carrying_10: "Ball-Carrying 10",
    two_way_10: "Two-Way 10",
    classic_10_trequartista: "Classic #10 / Trequartista",
    shadow_striker: "Shadow Striker",
    enganche: "Enganche",
    raumdeuter: "Raumdeuter",
    stopper_no_nonsense_cb: "Stopper / No-nonsense CB",
    ball_playing_defender: "Ball-Playing Defender",
    sweeper_libero: "Sweeper / Libero",
    wide_centre_back: "Wide Centre-Back",
    box_defender: "Stopper / No-nonsense CB",
    front_foot_stopper: "Stopper / No-nonsense CB",
    aerial_dominator: "Stopper / No-nonsense CB",
    ball_playing_cb: "Ball-Playing Defender",
    composed_retainer: "Ball-Playing Defender",
    sweeper_recovery_cb: "Sweeper / Libero",
  }
  return archetype ? labels[archetype] ?? archetype : null
}

export const formatCmArchetype = formatRoleArchetype

export type ScoreConfidenceBand = "limited" | "moderate" | "trusted"

export function scoreConfidenceBand(
  confidence: number | null | undefined,
  ratedMinutes: number | null | undefined,
): ScoreConfidenceBand {
  const value = confidence == null ? (ratedMinutes ?? 0) / 600 * 45 : Number(confidence)
  if (value < 45) return "limited"
  if (value < 70) return "moderate"
  return "trusted"
}

export function scoreConfidenceLabel(
  confidence: number | null | undefined,
  ratedMinutes: number | null | undefined,
) {
  const band = scoreConfidenceBand(confidence, ratedMinutes)
  if (band === "limited") return "Limited confidence"
  if (band === "moderate") return "Moderate confidence"
  return "Trusted confidence"
}

export function scoreConfidenceDetail(
  confidence: number | null | undefined,
  ratedMinutes: number | null | undefined,
) {
  const mins = ratedMinutes ?? 0
  if (confidence == null) return `${mins} rated minutes`
  return `${Math.round(Number(confidence))}% confidence · ${mins} rated minutes`
}
