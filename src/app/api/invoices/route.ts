import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { withRoute } from "@/lib/route";
import { uploadInvoice } from "@/lib/services/invoices";
import { tx } from "@/lib/tenant";

export const maxDuration = 60;

export async function POST(req: Request) {
  return withRoute("invoices.upload", "invoices.upload", async (t) => {
    await rateLimit(`invoice-upload:${t.businessId}`, 60, 3600);
    const maxBytes = env().MAX_INVOICE_FILE_MB * 1024 * 1024;
    if (Number(req.headers.get("content-length") ?? 0) > maxBytes + 64 * 1024) throw new AppError(`Invoices can be up to ${env().MAX_INVOICE_FILE_MB} MB.`, 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose an invoice file.");
    if (file.size > maxBytes) throw new AppError(`Invoices can be up to ${env().MAX_INVOICE_FILE_MB} MB.`, 413);
    const r = await tx(t, async (db) => uploadInvoice(db, t, file.name || "invoice", Buffer.from(await file.arrayBuffer())));
    return NextResponse.json(r);
  });
}
