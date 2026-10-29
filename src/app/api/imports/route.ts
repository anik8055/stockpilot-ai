import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth/rate-limit";
import { IMPORT_KINDS, type ImportKind } from "@/lib/domain/imports/fields";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { withRoute } from "@/lib/route";
import { createImportJob } from "@/lib/services/imports";
import { tx } from "@/lib/tenant";

export async function POST(req: Request) {
  return withRoute("imports.run", "imports.upload", async (t) => {
    await rateLimit(`import-upload:${t.businessId}`, 60, 3600);
    const maxBytes = env().MAX_IMPORT_FILE_MB * 1024 * 1024;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > maxBytes + 64 * 1024) throw new AppError(`Files can be up to ${env().MAX_IMPORT_FILE_MB} MB.`, 413);
    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "") as ImportKind;
    if (!(kind in IMPORT_KINDS)) throw new AppError("Choose what kind of data this file contains.");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a file to upload.");
    if (file.size > maxBytes) throw new AppError(`Files can be up to ${env().MAX_IMPORT_FILE_MB} MB.`, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const id = await tx(t, (db) => createImportJob(db, { ...t, timezone: t.business.timezone }, kind, file.name || "upload.csv", buf));
    return NextResponse.json({ id });
  });
}
