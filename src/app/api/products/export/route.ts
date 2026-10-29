import { fileResponse, withRoute } from "@/lib/route";
import { exportProductsCsv } from "@/lib/services/catalog";
import { tx } from "@/lib/tenant";
import { todayIn } from "@/lib/domain/dates";

export async function GET() {
  return withRoute("view", "products.export", async (t) => {
    const csv = await tx(t, (db) => exportProductsCsv(db, t.businessId));
    return fileResponse(csv, `products-${todayIn(t.business.timezone)}.csv`, "text/csv; charset=utf-8");
  });
}
