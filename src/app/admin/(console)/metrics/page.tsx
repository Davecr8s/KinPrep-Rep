import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { pilotMeasures } from "@/lib/admin/metrics";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";

export const metadata: Metadata = { title: "Pilot metrics" };

const TONE = {
  go: "bg-green-50 text-green-800 border-green-700",
  watch: "bg-orange-light/40 text-navy-dark border-orange",
  stop: "bg-red-50 text-red-800 border-red-700",
};
const LABEL = { go: "Go", watch: "Keep going", stop: "Stop line" };

// The go/stop measures from the brief, against their thresholds.
export default async function MetricsPage() {
  await requireAdmin("/admin/metrics");
  const rows = await pilotMeasures(appSql(), new Date());
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-navy-dark">Pilot go / stop measures</h1>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map(({ measure, value, status, how }) => {
          const unit = measure.unit === "percent" ? "%" : "";
          return (
            <li key={measure.key}>
              <Card className={`border-l-8 ${TONE[status]}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">{measure.label}</p>
                  <span className="text-sm font-bold">{LABEL[status]}</span>
                </div>
                <p className="text-3xl font-bold">
                  {value}
                  {unit}
                </p>
                <p className="text-sm">
                  Go: {measure.go}
                  {unit}
                  {"outOf" in measure && measure.outOf ? ` of ${measure.outOf}` : ""}
                  {"stopBelow" in measure && measure.stopBelow !== undefined
                    ? ` · stop below ${measure.stopBelow}${unit}`
                    : " · no stop line"}
                </p>
                <p className="mt-1 text-sm opacity-80">{how}</p>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
