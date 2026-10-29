import { fileResponse, withRoute } from "@/lib/route";
import { getReport, reportCsv } from "@/lib/services/reports";
import { tx } from "@/lib/tenant";

const SECTIONS = ["reorder", "stockouts", "slow", "suppliers"] as const;

export async function GET(req: Request, ctx: RouteContext<"/api/reports/[id]/csv">) {
  const { id } = await ctx.params;
  return withRoute("view", "report.csv", async (t) => {
    const section = (new URL(req.url).searchParams.get("section") ?? "reorder") as (typeof SECTIONS)[number];
    if (!SECTIONS.includes(section)) return new Response("Unknown section", { status: 400 });
    const r = await tx(t, (db) => getReport(db, t.businessId, id));
    return fileResponse(reportCsv(r.data, section), `report-${section}-${r.data.period.start}-to-${r.data.period.end}.csv`, "text/csv; charset=utf-8");
  });
}
