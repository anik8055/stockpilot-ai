import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

/** Subscribe → pay on the (simulated) Razorpay page → webhook activates the plan → cancel at period end. */
test("owner subscribes to Growth and cancels", async ({ page }) => {
  await signUp(page, `e2e-billing-${Date.now()}@test.local`);
  await page.getByLabel("Business name").fill("E2E Billing Traders");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app\/imports/);

  await page.goto("/app/settings?tab=plan");
  await expect(page.getByRole("heading", { name: /Current plan: Free trial/ })).toBeVisible();
  await page.getByRole("button", { name: "Subscribe to Growth" }).click();
  await expect(page.getByRole("heading", { name: "Test payment page" })).toBeVisible();
  await page.getByRole("button", { name: "Pay (test)" }).click();

  await expect(page).toHaveURL(/\/app\/settings\?tab=plan/);
  await expect(page.getByRole("heading", { name: /Current plan: Growth/ })).toBeVisible();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Subscribe to/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page.getByText("Subscription cancelled. Your plan stays active until the end of the paid period.")).toBeVisible();
  await expect(page.getByText(/· ends /)).toBeVisible();
});
