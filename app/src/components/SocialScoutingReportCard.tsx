export type SocialMetric = {
  label: string;
  value?: number | null;
  rank?: string | null;
};

export type SocialScoutingReportCardProps = {
  playerName: string;
  teamName?: string | null;
  positionLabel?: string | null;
  seasonLabel?: string | null;
  comparisonPool?: string | null;
  headline: string;
  topSignals: SocialMetric[];
  usageItems: string[];
  concernItems: string[];
  evidenceRows: SocialMetric[];
  seasonRows?: SocialMetric[];
  modelScore?: number | null;
  confidence?: number | null;
  ratedMinutes?: number | null;
};

function metricColor(value: number | null | undefined) {
  if (value == null) return "#8a8f98";
  if (value >= 70) return "#33c28d";
  if (value >= 40) return "#f2b84b";
  return "#f06c64";
}

function pctText(value: number | null | undefined) {
  return value == null ? "No rank" : `${Math.round(Number(value))}th pct`;
}

function scoreText(value: number | null | undefined) {
  return value == null ? "N/A" : `${Math.round(Number(value))}`;
}

function BarMetric({ row }: { row: SocialMetric }) {
  const value = row.value == null ? 0 : Math.max(0, Math.min(100, Number(row.value)));
  const color = metricColor(row.value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
        <span style={{ color: "#f7f3ea", fontSize: 22, fontWeight: 700 }}>{row.label}</span>
        <span style={{ color, fontSize: 22, fontWeight: 800 }}>{row.rank ?? pctText(row.value)}</span>
      </div>
      <div
        style={{
          height: 12,
          width: "100%",
          borderRadius: 999,
          background: "#242830",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function MiniMetric({ row }: { row: SocialMetric }) {
  const color = metricColor(row.value);

  return (
    <div
      style={{
        border: "1px solid #2e343d",
        borderRadius: 14,
        padding: "10px 12px",
        background: "#15191f",
        minHeight: 62,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 6,
      }}
    >
      <span style={{ color: "#aeb6c2", fontSize: 16, lineHeight: 1.08 }}>{row.label}</span>
      <span style={{ color, fontSize: 20, lineHeight: 1, fontWeight: 800 }}>{row.rank ?? pctText(row.value)}</span>
    </div>
  );
}

export default function SocialScoutingReportCard({
  playerName,
  teamName,
  positionLabel,
  seasonLabel,
  comparisonPool,
  headline,
  topSignals,
  usageItems,
  concernItems,
  evidenceRows,
  seasonRows = [],
  modelScore,
  confidence,
  ratedMinutes,
}: SocialScoutingReportCardProps) {
  const top = topSignals.slice(0, 3);
  const evidence = evidenceRows;
  const seasonEvidence = seasonRows;
  const watchItems = concernItems.length > 0 ? concernItems.slice(0, 2) : ["No major red flag from the available peer signals."];
  const usage = usageItems.length > 0 ? usageItems.slice(0, 2) : ["Use the strongest signals as the role starting point."];

  return (
    <article
      style={{
        width: 1080,
        height: 1350,
        background: "#0a0d11",
        color: "#f7f3ea",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        padding: 40,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, rgba(51, 194, 141, 0.14), transparent 36%), linear-gradient(0deg, rgba(255,255,255,0.04), transparent 48%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ color: "#33c28d", fontSize: 21, fontWeight: 900, textTransform: "uppercase" }}>
              Know Ball Scout Report
            </div>
            <h1 style={{ margin: 0, color: "#fffaf1", fontSize: 54, lineHeight: 0.96, fontWeight: 900 }}>
              {playerName}
            </h1>
            <div style={{ color: "#c8d0da", fontSize: 20, lineHeight: 1.12 }}>
              {[teamName, positionLabel, seasonLabel].filter(Boolean).join(" | ")}
            </div>
          </div>
          <div
            style={{
              minWidth: 154,
              border: "1px solid #33404b",
              borderRadius: 18,
              padding: "14px 18px",
              background: "#121820",
              textAlign: "center",
            }}
          >
            <div style={{ color: "#aeb6c2", fontSize: 16, fontWeight: 700 }}>KB Score</div>
            <div style={{ color: "#fffaf1", fontSize: 46, fontWeight: 900, lineHeight: 1 }}>
              {scoreText(modelScore)}
            </div>
          </div>
        </header>

        <section
          style={{
            border: "1px solid #2e343d",
            borderRadius: 20,
            padding: 20,
            background: "#11161c",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          <div style={{ color: "#aeb6c2", fontSize: 18, fontWeight: 800, textTransform: "uppercase" }}>
            Main Read
          </div>
          <p style={{ margin: 0, color: "#fffaf1", fontSize: 27, lineHeight: 1.12, fontWeight: 800 }}>
            {headline}
          </p>
        </section>

        <div style={{ color: "#aeb6c2", fontSize: 17, lineHeight: 1.15, padding: "0 20px" }}>
          Compared with {comparisonPool ?? "the selected peer pool"}
          {ratedMinutes != null ? ` | ${Math.round(Number(ratedMinutes)).toLocaleString()} rated mins` : ""}
          {confidence != null ? ` | ${Math.round(Number(confidence))}% confidence` : ""}
        </div>

        <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 13 }}>
          {top.map((row) => (
            <BarMetric key={row.label} row={row} />
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
          <div
            style={{
              border: "1px solid #2e343d",
              borderRadius: 19,
              padding: 18,
              background: "#11161c",
              display: "flex",
              flexDirection: "column",
              gap: 11,
            }}
          >
            <div style={{ color: "#33c28d", fontSize: 20, fontWeight: 900 }}>Best Usage</div>
            {usage.map((item) => (
              <div key={item} style={{ color: "#f7f3ea", fontSize: 19, lineHeight: 1.16 }}>
                {item}
              </div>
            ))}
          </div>
          <div
            style={{
              border: "1px solid #2e343d",
              borderRadius: 19,
              padding: 18,
              background: "#11161c",
              display: "flex",
              flexDirection: "column",
              gap: 11,
            }}
          >
            <div style={{ color: "#f2b84b", fontSize: 20, fontWeight: 900 }}>Watch Areas</div>
            {watchItems.map((item) => (
              <div key={item} style={{ color: "#f7f3ea", fontSize: 19, lineHeight: 1.16 }}>
                {item}
              </div>
            ))}
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {evidence.map((row) => (
            <MiniMetric key={row.label} row={row} />
          ))}
        </section>

        {seasonEvidence.length > 0 && (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {seasonEvidence.map((row) => (
              <MiniMetric key={row.label} row={row} />
            ))}
          </section>
        )}

        <footer
          style={{
            marginTop: "auto",
            borderTop: "1px solid #2e343d",
            paddingTop: 14,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            color: "#8f98a3",
            fontSize: 16,
            lineHeight: 1.25,
          }}
        >
          <span>Match-rating signals identify what the player did well. Season-only metrics add context.</span>
          <span style={{ color: "#33c28d", fontWeight: 900 }}>know-ball</span>
        </footer>
      </div>
    </article>
  );
}
