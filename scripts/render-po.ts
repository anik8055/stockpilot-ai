/* Dev helper: renders the first purchase order of the demo workspace to a PDF file. */
import { writeFileSync } from "node:fs";
import { loadEnvFiles } from "./load-env";
loadEnvFiles();
async function main() {
  const { withAdmin, withTenant, closePools } = await import("@/lib/db");
  const { purchaseOrderPdf } = await import("@/lib/services/po-pdf");
  const r = await withAdmin((tx) => tx.one<{ id: string; bid: string; uid: string }>("SELECT o.id, o.business_id AS bid, o.created_by AS uid FROM purchase_orders o JOIN businesses b ON b.id = o.business_id WHERE b.is_demo ORDER BY o.po_number LIMIT 1"));
  const { buffer } = await withTenant({ userId: r.uid, businessId: r.bid }, (tx) => purchaseOrderPdf(tx, r.bid, r.id));
  writeFileSync(process.argv[2], buffer);
  await closePools();
}
main();
