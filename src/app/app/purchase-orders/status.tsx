import { Badge } from "@/components/ui";

const MAP: Record<string, [string, "neutral" | "info" | "warn" | "ok" | "danger"]> = {
  draft: ["Draft", "neutral"],
  sent: ["Sent — awaiting goods", "info"],
  partially_received: ["Partly received", "warn"],
  received: ["Received", "ok"],
  cancelled: ["Cancelled", "danger"],
};

export function PoStatusBadge({ status }: { status: string }) {
  const [label, tone] = MAP[status] ?? [status, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}
