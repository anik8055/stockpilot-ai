import { describe, expect, it } from "vitest";
import { S3Store } from "@/lib/storage";

/**
 * Runs against a real S3-compatible server when S3_TEST_* variables are set, e.g. a local moto server with
 * signature checking enabled (see docs/DEPLOYMENT.md → "Testing the S3 driver"). Skipped otherwise.
 */
const e = process.env;
const configured = !!(e.S3_TEST_ENDPOINT && e.S3_TEST_BUCKET && e.S3_TEST_ACCESS_KEY_ID && e.S3_TEST_SECRET_ACCESS_KEY);

describe.skipIf(!configured)("S3 storage driver against a live S3-compatible server", () => {
  const store = () => new S3Store(e.S3_TEST_ENDPOINT!, e.S3_TEST_REGION ?? "ap-south-1", e.S3_TEST_BUCKET!, e.S3_TEST_ACCESS_KEY_ID!, e.S3_TEST_SECRET_ACCESS_KEY!);
  const prefix = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;

  it("puts, gets and removes an object", async () => {
    const s = store();
    const key = `${prefix}/invoices/inv (1).pdf`;
    await s.put(key, Buffer.from("%PDF-1.4 test"), "application/pdf");
    expect((await s.get(key)).toString()).toBe("%PDF-1.4 test");
    await s.remove(key);
    await expect(s.get(key)).rejects.toThrow(/HTTP 404/);
    await s.remove(key); // deleting a missing object is not an error
  });

  it("removes a whole prefix across several list pages", async () => {
    const s = store();
    for (let i = 0; i < 1005; i += 1) await s.put(`${prefix}/imports/f${i}`, Buffer.from(String(i)), "text/plain");
    await s.put(`${prefix}x/keep`, Buffer.from("other tenant"), "text/plain");
    await s.removePrefix(`${prefix}/`);
    await expect(s.get(`${prefix}/imports/f0`)).rejects.toThrow(/HTTP 404/);
    await expect(s.get(`${prefix}/imports/f1004`)).rejects.toThrow(/HTTP 404/);
    expect((await s.get(`${prefix}x/keep`)).toString()).toBe("other tenant");
    await s.remove(`${prefix}x/keep`);
  }, 120_000);

  it("is rejected with wrong credentials", async () => {
    const bad = new S3Store(e.S3_TEST_ENDPOINT!, "ap-south-1", e.S3_TEST_BUCKET!, e.S3_TEST_ACCESS_KEY_ID!, "wrong-secret");
    await expect(bad.put(`${prefix}/x`, Buffer.from("x"), "text/plain")).rejects.toThrow(/HTTP 403/);
  });
});
