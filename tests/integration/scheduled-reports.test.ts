import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { createBusiness, joinBusinessByCode } from "@/lib/services/workspaces";
import { previousWeek, runWeeklyReports } from "@/lib/services/scheduled-reports";
import { resetTestDatabase } from "./db";

process.env.CRON_SECRET = "cron-test-secret-0123456789";

let owner: string;
let admin: string;
let staff: string;
let on: string;
let off: string;

async function user(email: string) {
  return (await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ($1, 'U', 'x') RETURNING id", [email]))).id;
}
const emails = () => withAdmin((tx) => tx.query<{ to_email: string }>("SELECT to_email FROM outbound_emails WHERE template = 'weekly_report' ORDER BY to_email"));

beforeAll(async () => {
  await resetTestDatabase();
  owner = await user("owner@sched.test");
  admin = await user("admin@sched.test");
  staff = await user("staff@sched.test");
  on = (await createBusiness(owner, { name: "Opted In Traders", industry: "electrical" })).id;
  off = (await createBusiness(admin, { name: "Opted Out Traders", industry: "hardware" })).id;
  const code = (await withAdmin((tx) => tx.one<{ join_code: string }>("SELECT join_code FROM businesses WHERE id = $1", [on]))).join_code;
  await joinBusinessByCode(admin, code);
  await joinBusinessByCode(staff, code);
  await withAdmin((tx) => tx.query("UPDATE memberships SET role = 'admin' WHERE business_id = $1 AND user_id = $2", [on, admin]));
  // Opt in through the app role, as the Reports page does (column grant allows only this column).
  await withTenant({ userId: owner, businessId: on }, (tx) => tx.query("UPDATE businesses SET weekly_report_email = true WHERE id = $1", [on]));
});
afterAll(closePools);

describe("previousWeek", () => {
  it("returns the last complete Monday–Sunday week", () => {
    expect(previousWeek("2026-11-02")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Monday
    expect(previousWeek("2026-11-01")).toEqual({ start: "2026-10-19", end: "2026-10-25" }); // Sunday
    expect(previousWeek("2026-10-29")).toEqual({ start: "2026-10-19", end: "2026-10-25" }); // Thursday
  });
});

describe("weekly report emails", () => {
  const monday = new Date("2026-11-02T03:30:00Z");

  it("creates last week's report for opted-in workspaces and emails owners and admins only", async () => {
    const results = await runWeeklyReports(monday);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ businessId: on, status: "sent", recipients: 2 });
    expect((await emails()).map((e) => e.to_email)).toEqual(["admin@sched.test", "owner@sched.test"]);
    const r = await withAdmin((tx) => tx.one<{ period_start: string; period_end: string; scheduled: boolean }>(
      "SELECT period_start::text, period_end::text, scheduled FROM reports WHERE business_id = $1", [on]));
    expect(r).toEqual({ period_start: "2026-10-26", period_end: "2026-11-01", scheduled: true });
    expect(await withAdmin((tx) => tx.query("SELECT 1 FROM reports WHERE business_id = $1", [off]))).toHaveLength(0);
  });

  it("does not create or send twice when the scheduler fires again", async () => {
    const again = await runWeeklyReports(new Date("2026-11-02T09:00:00Z"));
    expect(again[0]).toMatchObject({ status: "already_done" });
    expect(await emails()).toHaveLength(2);
  });

  it("the cron endpoint requires the bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/weekly-reports/route");
    expect((await GET(new Request("http://x/api/cron/weekly-reports"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/weekly-reports", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const ok = await GET(new Request("http://x/api/cron/weekly-reports", { headers: { authorization: "Bearer cron-test-secret-0123456789" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ workspaces: 1, failed: 0 });
  });
});
