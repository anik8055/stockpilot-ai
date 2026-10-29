"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/action-result";
import { rateLimit } from "@/lib/auth/rate-limit";
import type { Mapping } from "@/lib/domain/imports/mapping";
import type { DateOrder } from "@/lib/domain/imports/values";
import { AppError } from "@/lib/errors";
import { cancelImport, changeSheet, commitImport, getImportJob, validateImport } from "@/lib/services/imports";
import { requireTenant, tx } from "@/lib/tenant";

const jobIdOf = (fd: FormData) => {
  const id = String(fd.get("jobId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("Invalid import.");
  return id;
};

export async function validateImportAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("imports.validate", async () => {
    const t = await requireTenant("imports.run");
    await rateLimit(`import-validate:${t.businessId}`, 120, 3600);
    const jobId = jobIdOf(fd);
    const job = await tx(t, (db) => getImportJob(db, t.businessId, jobId));
    const suggestion = job.options.suggestion;
    if (suggestion && suggestion.ambiguities.length > 0 && fd.get("confirmMapping") !== "on") {
      return { ok: false, message: "Some columns were matched with less certainty. Check the highlighted columns and tick the confirmation box." };
    }
    const mapping: Mapping = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("map_") || typeof v !== "string") continue;
      mapping[k.slice(4)] = v === "" ? null : Number(v);
    }
    const dateOrder = String(fd.get("dateOrder") ?? "") as DateOrder;
    await tx(t, (db) =>
      validateImport(
        db,
        { ...t, timezone: t.business.timezone },
        jobId,
        mapping,
        {
          dateOrder: ["dmy", "mdy", "ymd"].includes(dateOrder) ? dateOrder : job.options.dateOrder,
          snapshotDate: String(fd.get("snapshotDate") ?? "") || undefined,
          recordStock: fd.get("recordStock") === "on",
          updateCosts: fd.get("updateCosts") === "on",
        },
        fd.get("saveMapping") === "on" ? String(fd.get("mappingName") ?? "") || job.original_filename : null,
      ),
    );
    redirect(`/app/imports/${jobId}`);
  });
}

export async function commitImportAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("imports.commit", async () => {
    const t = await requireTenant("imports.run");
    const jobId = jobIdOf(fd);
    await tx(t, (db) => commitImport(db, { ...t, timezone: t.business.timezone }, jobId));
    revalidatePath("/app", "layout");
    redirect(`/app/imports/${jobId}?done=1`);
  });
}

export async function cancelImportAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("imports.cancel", async () => {
    const t = await requireTenant("imports.run");
    await tx(t, (db) => cancelImport(db, { ...t, timezone: t.business.timezone }, jobIdOf(fd)));
    redirect("/app/imports");
  });
}

export async function changeSheetAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("imports.sheet", async () => {
    const t = await requireTenant("imports.run");
    const jobId = jobIdOf(fd);
    const hr = String(fd.get("headerRow") ?? "");
    await tx(t, (db) => changeSheet(db, { ...t, timezone: t.business.timezone }, jobId, String(fd.get("sheet") ?? ""), hr === "" ? undefined : Number(hr) - 1));
    redirect(`/app/imports/${jobId}`);
  });
}

export async function editMappingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("imports.edit", async () => {
    const t = await requireTenant("imports.run");
    const jobId = jobIdOf(fd);
    await tx(t, (db) => db.query("UPDATE import_jobs SET status = 'uploaded' WHERE business_id = $1 AND id = $2 AND status = 'validated'", [t.businessId, jobId]));
    redirect(`/app/imports/${jobId}`);
  });
}
