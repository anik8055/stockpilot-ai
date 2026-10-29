import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { deleteAccount } from "@/lib/services/accounts";
import { ask } from "@/lib/services/assistant/assistant";
import { createProduct } from "@/lib/services/catalog";
import { getEntitlements } from "@/lib/services/entitlements";
import { createImportJob } from "@/lib/services/imports";
import { uploadInvoice } from "@/lib/services/invoices";
import { createBusiness, deleteBusiness, joinBusinessByCode } from "@/lib/services/workspaces";
import { parseBusinessSettings } from "@/lib/domain/settings";
import { resetTestDatabase } from "./db";

const settings = parseBusinessSettings({}).analysis;
let owner: string;
let biz: string;

async function user(email: string, password = "x") {
  const hash = password === "x" ? "x" : await hashPassword(password);
  return (await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ($1, 'U', $2) RETURNING id", [email, hash]))).id;
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await user("owner@test.local", "Owner-pass-2026");
  biz = (await createBusiness(owner, { name: "Plan Test", industry: "general" })).id;
});

afterAll(closePools);

describe("plan entitlements are enforced on the server", () => {
  const ctx = () => ({ userId: owner, businessId: biz });

  it("starts on a trial with Growth features", async () => {
    const e = await withTenant(ctx(), (tx) => getEntitlements(tx, biz));
    expect(e.plan.code).toBe("trial");
    expect(e.features.assistant).toBe(true);
  });

  it("falls back to Starter features when the trial has expired", async () => {
    await withAdmin((tx) => tx.query("UPDATE businesses SET trial_ends_at = now() - interval '1 day' WHERE id = $1", [biz]));
    const e = await withTenant(ctx(), (tx) => getEntitlements(tx, biz));
    expect(e.trialExpired).toBe(true);
    expect(e.features.assistant).toBe(false);
    await expect(withTenant(ctx(), (tx) => ask(tx, { ...ctx(), settings, timezone: "Asia/Kolkata" }, "what should I order?"))).rejects.toThrow(/not included/);
    await expect(withTenant(ctx(), (tx) => uploadInvoice(tx, ctx(), "x.pdf", Buffer.from("%PDF-1.4")))).rejects.toThrow(/not included/);
    await withAdmin((tx) => tx.query("UPDATE businesses SET trial_ends_at = now() + interval '10 days' WHERE id = $1", [biz]));
  });

  it("limits the number of products", async () => {
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{max_products}', '2') WHERE code = 'trial'"));
    await withTenant(ctx(), (tx) => createProduct(tx, ctx(), { sku: "A", name: "A", base_unit: "pcs" }));
    await withTenant(ctx(), (tx) => createProduct(tx, ctx(), { sku: "B", name: "B", base_unit: "pcs" }));
    await expect(withTenant(ctx(), (tx) => createProduct(tx, ctx(), { sku: "C", name: "C", base_unit: "pcs" }))).rejects.toThrow(/plan allows 2 products/);
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{max_products}', '2000') WHERE code = 'trial'"));
  });

  it("limits team size", async () => {
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{max_members}', '2') WHERE code = 'trial'"));
    const code = (await withAdmin((tx) => tx.one<{ join_code: string }>("SELECT join_code FROM businesses WHERE id = $1", [biz]))).join_code;
    await joinBusinessByCode(await user("m1@test.local"), code);
    await expect(joinBusinessByCode(await user("m2@test.local"), code)).rejects.toThrow(/limit of 2 team members/);
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{max_members}', '3') WHERE code = 'trial'"));
  });

  it("limits workspaces per owner", async () => {
    await expect(createBusiness(owner, { name: "Second", industry: "general" })).rejects.toThrow(/allows 1 business workspace/);
  });

  it("enforces monthly import quotas", async () => {
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{imports_per_month}', '0') WHERE code = 'trial'"));
    const { commitImport, validateImport, getImportJob } = await import("@/lib/services/imports");
    const c = { ...ctx(), timezone: "Asia/Kolkata" };
    const id = await withTenant(ctx(), (tx) => createImportJob(tx, c, "products", "p.csv", Buffer.from("SKU,Name\nZ,Zed\n")));
    const job = await withTenant(ctx(), (tx) => getImportJob(tx, biz, id));
    await withTenant(ctx(), (tx) => validateImport(tx, c, id, job.mapping!, {}));
    await expect(withTenant(ctx(), (tx) => commitImport(tx, c, id))).rejects.toThrow(/used all 0 imports/);
    await withAdmin((tx) => tx.query("UPDATE plans SET limits = jsonb_set(limits, '{imports_per_month}', '50') WHERE code = 'trial'"));
  });
});

describe("data deletion", () => {
  it("deleting a workspace removes its data and stored files", async () => {
    const u = await user("del@test.local");
    const b = (await createBusiness(u, { name: "Delete Me", industry: "general" })).id;
    const ctx = { userId: u, businessId: b, timezone: "Asia/Kolkata" };
    await withTenant(ctx, (tx) => createImportJob(tx, ctx, "products", "p.csv", Buffer.from("SKU,Name\nQ,Q\n")));
    const dir = path.resolve(process.env.STORAGE_DIR!, b);
    expect(existsSync(dir)).toBe(true);
    await deleteBusiness({ ...ctx, role: "owner" });
    expect(existsSync(dir)).toBe(false);
    const left = await withAdmin((tx) => tx.one<{ c: number }>("SELECT (SELECT count(*) FROM import_jobs WHERE business_id = $1) + (SELECT count(*) FROM audit_events WHERE business_id = $1) AS c", [b]));
    expect(Number(left.c)).toBe(0);
  });

  it("staff cannot delete a workspace", async () => {
    await expect(deleteBusiness({ userId: owner, businessId: biz, role: "staff" })).rejects.toThrow(/Only an owner/);
  });

  it("deleting an account removes sole-owned workspaces and requires the password", async () => {
    const u = await user("acct@test.local", "Acct-pass-2026");
    const b = (await createBusiness(u, { name: "Sole Owner Co", industry: "general" })).id;
    await expect(deleteAccount(u, "wrong-password-1")).rejects.toThrow(/incorrect/);
    const r = await deleteAccount(u, "Acct-pass-2026");
    expect(r.deletedWorkspaces).toBe(1);
    const gone = await withAdmin((tx) => tx.one<{ u: number; b: number }>("SELECT (SELECT count(*)::int FROM users WHERE id = $1) AS u, (SELECT count(*)::int FROM businesses WHERE id = $2) AS b", [u, b]));
    expect(gone).toEqual({ u: 0, b: 0 });
  });
});
