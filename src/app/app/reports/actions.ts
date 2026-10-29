"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/action-result";
import { rateLimit } from "@/lib/auth/rate-limit";
import { addDays, todayIn } from "@/lib/domain/dates";
import { AppError } from "@/lib/errors";
import { buildWeeklyReport, saveReport } from "@/lib/services/reports";
import { requireTenant, tx } from "@/lib/tenant";

export async function generateReportAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("report.generate", async () => {
    const t = await requireTenant("reports.generate");
    await rateLimit(`report:${t.businessId}`, 30, 3600);
    const today = todayIn(t.business.timezone);
    const preset = String(fd.get("preset") ?? "last7");
    let start: string;
    let end: string;
    if (preset === "custom") {
      start = String(fd.get("start") ?? "");
      end = String(fd.get("end") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new AppError("Choose a start and end date.");
    } else if (preset === "prevweek") {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      end = addDays(today, -dow - 1);
      start = addDays(end, -6);
    } else if (preset === "last30") {
      end = addDays(today, -1);
      start = addDays(end, -29);
    } else {
      end = addDays(today, -1);
      start = addDays(end, -6);
    }
    const id = await tx(t, async (db) => saveReport(db, t, await buildWeeklyReport(db, t.businessId, t.business.settings.analysis, t.business.timezone, { start, end })));
    redirect(`/app/reports/${id}`);
  });
}
