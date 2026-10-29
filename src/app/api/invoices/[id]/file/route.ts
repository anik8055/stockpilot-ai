import { withRoute } from "@/lib/route";
import { getInvoice } from "@/lib/services/invoices";
import { storage } from "@/lib/storage";
import { tx } from "@/lib/tenant";

/** Streams the original upload back to members of the workspace only. Served as an attachment, never inline HTML. */
export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]/file">) {
  const { id } = await ctx.params;
  return withRoute("view", "invoices.file", async (t) => {
    const { doc } = await tx(t, (db) => getInvoice(db, t.businessId, id));
    const body = await storage().get(doc.storage_key);
    const inline = doc.mime_type === "application/pdf" || doc.mime_type.startsWith("image/");
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.original_filename.replace(/[^\w.\- ]+/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
