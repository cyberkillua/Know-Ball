import { AlertTriangle, Fingerprint } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import type { StyleProfile, StyleTraitItem } from "../lib/types"

function confidenceClass(level: StyleProfile["confidence"]["level"]) {
  if (level === "high") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
  if (level === "moderate") return "border-amber-500/30 bg-amber-500/10 text-amber-300"
  return "border-border bg-muted text-muted-foreground"
}

function fillClass(score: number, risk = false) {
  if (risk) return score >= 70 ? "bg-rose-500" : score >= 50 ? "bg-amber-400" : "bg-muted-foreground/50"
  if (score >= 75) return "bg-emerald-500"
  if (score >= 55) return "bg-amber-400"
  return "bg-muted-foreground/50"
}

function TraitRow({ trait }: { trait: StyleTraitItem }) {
  const score = Math.max(0, Math.min(100, Math.round(Number(trait.score) || 0)))
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-semibold text-foreground">{trait.label}</span>
        <span className="shrink-0 font-bold tabular-nums text-foreground">{score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${fillClass(score, trait.risk)}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

export default function StyleFingerprintCard({ styleProfile }: { styleProfile: StyleProfile }) {
  const primary = styleProfile.primary
  const confidence = styleProfile.confidence
  const risks = styleProfile.risks.filter((risk) => risk.score >= 50)
  const topEvidence = primary.evidence.slice(0, 3)
  const topStrengths = styleProfile.strengths.slice(0, 4)

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Fingerprint size={15} />
          <span>Style Fingerprint</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold leading-tight text-foreground">
              {primary.label}
            </div>
            <div className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {primary.description}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${confidenceClass(confidence.level)}`}>
                {confidence.level === "high" ? "High" : confidence.level === "moderate" ? "Moderate" : "Low"} confidence
              </span>
              <span>{Math.round(styleProfile.coverage)}% input coverage</span>
              {confidence.reasons.slice(0, 2).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-baseline gap-0.5">
            <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
              {Math.round(primary.score)}
            </span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Traits
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {topStrengths.map((trait) => (
                <TraitRow key={trait.key} trait={trait} />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Evidence
              </div>
              <div className="flex flex-wrap gap-2">
                {topEvidence.map((signal) => (
                  <span
                    key={signal.metric}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
                  >
                    <span>{signal.label}</span>
                    <span className="font-bold tabular-nums text-foreground">
                      {Math.round(signal.value)}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {risks.length > 0 && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
                  <AlertTriangle size={13} />
                  <span>Risk Flags</span>
                </div>
                <div className="space-y-2">
                  {risks.map((risk) => (
                    <TraitRow key={risk.key} trait={risk} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
