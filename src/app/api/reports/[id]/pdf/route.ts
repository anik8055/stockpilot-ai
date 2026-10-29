import { fileResponse, withRoute } from "@/lib/route";
import { getReport, reportPdf } from "@/lib/services/reports";
import { tx } from "@/lib/tenant";

export async function GET(_req: Request, ctx: RouteContext<"/api/reports/[id]/pdf">) {
  const { id } = await ctx.params;
  return withRoute("view", "report.pdf", async (t) => {
    const r = await tx(t, (db) => getReport(db, t.businessId, id));
    return fileResponse(await reportPdf(r.data), `inventory-report-${r.data.period.start}-to-${r.data.period.end}.pdf`, "application/pdf");
  });
}
