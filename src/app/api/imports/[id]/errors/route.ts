import { fileResponse, withRoute } from "@/lib/route";
import { errorReportCsv, getImportJob } from "@/lib/services/imports";
import { tx } from "@/lib/tenant";

export async function GET(_req: Request, ctx: RouteContext<"/api/imports/[id]/errors">) {
  const { id } = await ctx.params;
  return withRoute("view", "imports.errors", async (t) => {
    const csv = await tx(t, async (db) => errorReportCsv(db, t.businessId, await getImportJob(db, t.businessId, id)));
    return fileResponse(csv, `import-problems-${id.slice(0, 8)}.csv`, "text/csv; charset=utf-8");
  });
}
