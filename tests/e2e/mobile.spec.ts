import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

/** Mobile layout checks (Pixel 7 viewport). The Android app wraps this same UI. */
test("demo workspace is usable on a phone", async ({ page }) => {
  await signUp(page, `mobile-${Date.now()}@test.local`);
  await page.getByRole("button", { name: "Explore the demo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByText(/Demo workspace\./)).toBeVisible();

  const noSideScroll = async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  };
  await noSideScroll();

  // Navigation drawer
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Purchase list" }).click();
  await expect(page.getByRole("heading", { name: "Purchase list" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await noSideScroll();

  for (const path of ["/app/inventory", "/app/analytics?view=excess", "/app/imports/new", "/app/assistant", "/app/settings"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await noSideScroll();
  }

  // Wide tables scroll inside their container rather than the page
  await page.goto("/app/inventory");
  await expect(page.getByRole("table")).toBeVisible();
  await noSideScroll();
});
