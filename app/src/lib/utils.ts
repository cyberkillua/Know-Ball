import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCmArchetype(archetype: string | null | undefined) {
  const labels: Record<string, string> = {
    controller: "Controller",
    ball_winner: "Ball Winner",
    carrier: "Carrier",
    creator: "Creator",
    box_crasher: "Box Crasher",
  }
  return archetype ? labels[archetype] ?? archetype : null
}
