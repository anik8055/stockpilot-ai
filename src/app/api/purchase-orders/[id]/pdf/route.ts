import { fileResponse, withRoute } from "@/lib/route";
import { purchaseOrderPdf } from "@/lib/services/po-pdf";
import { tx } from "@/lib/tenant";

export async function GET(_req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/pdf">) {
  const { id } = await ctx.params;
  return withRoute("view", "po.pdf", async (t) => {
    const { buffer, filename } = await tx(t, (db) => purchaseOrderPdf(db, t.businessId, id));
    return fileResponse(buffer, filename, "application/pdf");
  });
}
