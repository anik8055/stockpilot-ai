import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant, withUser } from "@/lib/db";
import { hashToken } from "@/lib/auth/tokens";
import { setActiveBusiness } from "@/lib/auth/session";
import { createBusiness, joinBusinessByCode, listWorkspaces } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

let userA: string, userB: string, bizA: string, bizB: string, productA: string;

async function user(email: string) {
  return (await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id", [email, email]))).id;
}

beforeAll(async () => {
  await resetTestDatabase();
  userA = await user("a@test.local");
  userB = await user("b@test.local");
  bizA = (await createBusiness(userA, { name: "Alpha Traders", industry: "hardware" })).id;
  bizB = (await createBusiness(userB, { name: "Beta Spares", industry: "auto_parts" })).id;
  productA = (
    await withTenant({ userId: userA, businessId: bizA }, (tx) =>
      tx.one<{ id: string }>("INSERT INTO products (business_id, sku, name) VALUES ($1, 'A-1', 'Alpha secret item') RETURNING id", [bizA]),
    )
  ).id;
});

afterAll(async () => {
  await closePools();
});

describe("tenant isolation (RLS enforced by the database)", () => {
  it("lets members read their own data", async () => {
    const rows = await withTenant({ userId: userA, businessId: bizA }, (tx) => tx.query("SELECT id FROM products"));
    expect(rows).toHaveLength(1);
  });

  it("hides another tenant's rows even when queried by ID", async () => {
    const rows = await withTenant({ userId: userB, businessId: bizB }, (tx) => tx.query("SELECT id, name FROM products WHERE id = $1", [productA]));
    expect(rows).toHaveLength(0);
  });

  it("ignores a forged business context for a non-member (changing the tenant ID does not work)", async () => {
    const rows = await withTenant({ userId: userB, businessId: bizA }, (tx) => tx.query("SELECT id FROM products"));
    expect(rows).toHaveLength(0);
    const biz = await withTenant({ userId: userB, businessId: bizA }, (tx) => tx.query("SELECT id FROM businesses WHERE id = $1", [bizA]));
    expect(biz).toHaveLength(0);
  });

  it("rejects writes into another tenant", async () => {
    await expect(
      withTenant({ userId: userB, businessId: bizB }, (tx) => tx.query("INSERT INTO products (business_id, sku, name) VALUES ($1, 'X', 'x')", [bizA])),
    ).rejects.toThrow(/row-level security/);
    const updated = await withTenant({ userId: userB, businessId: bizB }, (tx) => tx.query("UPDATE products SET name = 'pwned' WHERE id = $1 RETURNING id", [productA]));
    expect(updated).toHaveLength(0);
    const deleted = await withTenant({ userId: userB, businessId: bizB }, (tx) => tx.query("DELETE FROM products WHERE id = $1 RETURNING id", [productA]));
    expect(deleted).toHaveLength(0);
  });

  it("does not let the app role read identity tables", async () => {
    await expect(withTenant({ userId: userA, businessId: bizA }, (tx) => tx.query("SELECT * FROM users"))).rejects.toThrow(/permission denied/);
    await expect(withTenant({ userId: userA, businessId: bizA }, (tx) => tx.query("SELECT * FROM sessions"))).rejects.toThrow(/permission denied/);
  });

  it("exposes member names only for the current workspace", async () => {
    const own = await withTenant({ userId: userA, businessId: bizA }, (tx) => tx.query("SELECT * FROM app.business_members()"));
    expect(own).toHaveLength(1);
    const forged = await withTenant({ userId: userB, businessId: bizA }, (tx) => tx.query("SELECT * FROM app.business_members()"));
    expect(forged).toHaveLength(0);
  });

  it("only switches a session to workspaces the user belongs to", async () => {
    const session = await withAdmin((tx) =>
      tx.one<{ id: string }>("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id", [userB, hashToken("t-b")]),
    );
    expect(await setActiveBusiness(session.id, userB, bizA)).toBe(false);
    expect(await setActiveBusiness(session.id, userB, bizB)).toBe(true);
    // Another user's session cannot be switched either
    expect(await setActiveBusiness(session.id, userA, bizA)).toBe(false);
  });

  it("lists only the user's own workspaces", async () => {
    const a = await listWorkspaces(userA);
    expect(a.map((w) => w.id)).toEqual([bizA]);
  });

  it("joins a workspace only with its join code, as staff", async () => {
    const code = (await withAdmin((tx) => tx.one<{ join_code: string }>("SELECT join_code FROM businesses WHERE id = $1", [bizA]))).join_code;
    await expect(joinBusinessByCode(userB, "WRONGCODE1")).rejects.toThrow(/not valid/);
    await joinBusinessByCode(userB, code.toLowerCase());
    const role = await withUser(userB, (tx) => tx.one<{ role: string }>("SELECT role FROM memberships WHERE business_id = $1 AND user_id = $2", [bizA, userB]));
    expect(role.role).toBe("staff");
    const rows = await withTenant({ userId: userB, businessId: bizA }, (tx) => tx.query("SELECT id FROM products"));
    expect(rows).toHaveLength(1);
  });
});

describe("ledger integrity", () => {
  const ctx = () => ({ userId: userA, businessId: bizA });

  it("maintains on_hand only through movements", async () => {
    await withTenant(ctx(), (tx) =>
      tx.query(
        `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, source_type, idempotency_key)
         VALUES ($1, $2, 'opening', 12, 'manual', 'test-open')`,
        [bizA, productA],
      ),
    );
    const p = await withTenant(ctx(), (tx) => tx.one<{ on_hand: string }>("SELECT on_hand FROM products WHERE id = $1", [productA]));
    expect(Number(p.on_hand)).toBe(12);
    await expect(withTenant(ctx(), (tx) => tx.query("UPDATE products SET on_hand = 99 WHERE id = $1", [productA]))).rejects.toThrow(/only change via inventory_movements/);
  });

  it("rejects duplicate movement idempotency keys", async () => {
    await expect(
      withTenant(ctx(), (tx) =>
        tx.query(
          `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, source_type, idempotency_key)
           VALUES ($1, $2, 'opening', 12, 'manual', 'test-open')`,
          [bizA, productA],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("does not allow editing or deleting movements", async () => {
    await expect(withTenant(ctx(), (tx) => tx.query("UPDATE inventory_movements SET quantity = 1"))).rejects.toThrow(/permission denied/);
    await expect(withAdmin((tx) => tx.query("DELETE FROM inventory_movements"))).rejects.toThrow(/append-only/);
  });

  it("deletes everything when a workspace is deleted (account deletion path)", async () => {
    await withAdmin((tx) => tx.query("DELETE FROM businesses WHERE id = $1", [bizB]));
    const n = await withAdmin((tx) => tx.one<{ c: number }>("SELECT count(*)::int AS c FROM audit_events WHERE business_id = $1", [bizB]));
    expect(n.c).toBe(0);
  });
});
