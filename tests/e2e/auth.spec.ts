import { expect, test } from "@playwright/test";

test("wrong password shows an error and keeps the email", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@test.local");
  await page.getByLabel("Password").fill("not-the-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("nobody@test.local");
});

test("protected pages redirect to sign in", async ({ page }) => {
  await page.goto("/app/inventory");
  await expect(page).toHaveURL(/\/login/);
});

test("password reset request gives the same answer for unknown emails", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("unknown@test.local");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
});

test("API routes reject anonymous requests", async ({ request }) => {
  const r = await request.get("/api/products/export");
  expect(r.status()).toBe(401);
  const up = await request.post("/api/imports", { multipart: { kind: "products", file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("SKU,Name\nA,B") } } });
  expect(up.status()).toBe(401);
});
