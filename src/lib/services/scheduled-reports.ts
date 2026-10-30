import "server-only";
import { withAdmin, withTenant } from "@/lib/db";
import { addDays, formatDate, todayIn, type ISODate } from "@/lib/domain/dates";
import { formatINR } from "@/lib/domain/money";
import { parseBusinessSettings } from "@/lib/domain/settings";
import { env } from "@/lib/env";
import { logError } from "@/lib/errors";
import { sendEmail } from "@/lib/services/email";
import { buildWeeklyReport, saveReport, type WeeklyReport } from "@/lib/services/reports";

/** The most recent complete Monday–Sunday week before `today`. */
export function previousWeek(today: ISODate): { start: ISODate; end: ISODate } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const end = addDays(today, -dow - 1);
  return { start: addDays(end, -6), end };
}

export function reportEmailText(d: WeeklyReport, url: string): string {
  const m = d.metrics;
  const lines = [
    `Weekly inventory report for ${d.business.name}`,
    `${formatDate(d.period.start)} – ${formatDate(d.period.end)}`,
    "",
    `Items to reorder: ${d.reorderTotal.items} (estimated ${formatINR(d.reorderTotal.value, { whole: true })} at last cost)`,
    `Stockout risks: ${d.stockoutRisks.length}`,
    `Out of stock now: ${m.outOfStock}   Low stock: ${m.lowStock}`,
    `Slow or non-moving items: ${d.slow.length}   Excess stock value: ${formatINR(d.excessValue, { whole: true })}`,
    `Sales this period: ${formatINR(d.sales.current.value, { whole: true })}${d.sales.changePct !== null && d.sales.comparable ? ` (${d.sales.changePct > 0 ? "+" : ""}${d.sales.changePct}% vs previous)` : ""}`,
  ];
  if (d.dataQuality.length) lines.push("", "Data to check:", ...d.dataQuality.slice(0, 5).map((q) => `- ${q}`));
  lines.push(
    "",
    `Open the full report (PDF and CSV downloads inside): ${url}`,
    "",
    "Figures are calculated from the data imported into StockPilot up to the dates shown in the report. Recommendations are suggestions — nothing is ordered automatically.",
    "You receive this because weekly report emails are switched on for this workspace (Reports page).",
  );
  return lines.join("\n");
}

export type RunResult = { businessId: string; status: "sent" | "already_done" | "failed"; recipients?: number; reportId?: string };

/**
 * Generates last week's report for every workspace that opted in and emails owners and admins a summary with a link.
 * Safe to call more than once: the report for a week is created once, and emails go out only when it is created.
 */
export async function runWeeklyReports(now = new Date()): Promise<RunResult[]> {
  const businesses = await withAdmin((tx) =>
    tx.query<{ id: string; timezone: string; settings: unknown; actor: string | null }>(
      `SELECT b.id, b.timezone, b.settings,
              (SELECT m.user_id FROM memberships m WHERE m.business_id = b.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS actor
         FROM businesses b
        WHERE b.weekly_report_email AND b.deleted_at IS NULL AND NOT b.is_demo`,
    ),
  );
  const results: RunResult[] = [];
  for (const b of businesses) {
    if (!b.actor) continue;
    try {
      const period = previousWeek(todayIn(b.timezone, now));
      const ctx = { userId: b.actor, businessId: b.id };
      const saved = await withTenant(ctx, async (db) => {
        const exists = await db.maybeOne("SELECT 1 FROM reports WHERE business_id = $1 AND period_start = $2 AND scheduled", [b.id, period.start]);
        if (exists) return null;
        const data = await buildWeeklyReport(db, b.id, parseBusinessSettings(b.settings).analysis, b.timezone, period);
        const id = await saveReport(db, ctx, data, { scheduled: true });
        return id ? { id, data } : null;
      });
      if (!saved) {
        results.push({ businessId: b.id, status: "already_done" });
        continue;
      }
      const recipients = await withAdmin((tx) =>
        tx.query<{ email: string }>(
          "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 AND m.role IN ('owner','admin') ORDER BY u.email",
          [b.id],
        ),
      );
      const url = `${env().APP_URL.replace(/\/$/, "")}/app/reports/${saved.id}`;
      for (const r of recipients) {
        await sendEmail({
          to: r.email,
          subject: `Weekly stock report: ${saved.data.business.name} (${formatDate(period.start)} – ${formatDate(period.end)})`,
          text: reportEmailText(saved.data, url),
          template: "weekly_report",
        });
      }
      results.push({ businessId: b.id, status: "sent", recipients: recipients.length, reportId: saved.id });
    } catch (err) {
      // One workspace failing must not stop the others.
      logError("cron.weekly_reports", err, { businessId: b.id });
      results.push({ businessId: b.id, status: "failed" });
    }
  }
  return results;
}
