import { Badge } from "@/components/ui";
import type { DataQuality } from "@/lib/domain/demand";
import type { Urgency } from "@/lib/domain/reorder";

const URGENCY: Record<Urgency, { label: string; tone: "danger" | "warn" | "info" | "neutral" | "ok" }> = {
  out_of_stock: { label: "Out of stock", tone: "danger" },
  critical: { label: "Runs out before delivery", tone: "danger" },
  reorder: { label: "Reorder", tone: "warn" },
  watch: { label: "Watch", tone: "info" },
  ok: { label: "OK", tone: "ok" },
  not_applicable: { label: "Not assessed", tone: "neutral" },
};

export function UrgencyBadge({ urgency, provisional }: { urgency: Urgency; provisional?: boolean }) {
  const u = URGENCY[urgency];
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      <Badge tone={u.tone}>{u.label}</Badge>
      {provisional && urgency !== "not_applicable" && (
        <Badge tone="neutral" title="Based on limited sales history or on minimum stock levels">
          Provisional
        </Badge>
      )}
    </span>
  );
}

export function QualityBadge({ quality }: { quality: DataQuality }) {
  const map = { good: ["Good data", "ok"], limited: ["Limited data", "warn"], insufficient: ["Too little history", "warn"], none: ["No sales data", "neutral"] } as const;
  const [label, tone] = map[quality];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const tone = confidence === "high" ? "ok" : confidence === "medium" ? "info" : "warn";
  return <Badge tone={tone}>{confidence === "high" ? "High" : confidence === "medium" ? "Medium" : "Low"} confidence</Badge>;
}
