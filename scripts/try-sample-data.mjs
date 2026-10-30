// Imports the sample dataset through the real UI of a running StockPilot server and saves screenshots.
// Usage: node scripts/try-sample-data.mjs <baseURL> <dataDir> <shotsDir>
import { chromium } from "playwright";
import path from "node:path";

const [base, dir, shots] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(60_000);
const email = `sample-${Date.now()}@test.local`;

await page.goto(`${base}/signup`);
await page.getByLabel("Your name").fill("Sample Owner");
await page.getByLabel("Work email").fill(email);
await page.getByLabel("Password").fill("Sample-Password-2026");
await page.getByRole("checkbox").check();
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/onboarding/);
await page.getByLabel("Business name").fill("Sample Electricals & Hardware");
await page.getByLabel("What do you sell?").selectOption("electrical");
await page.getByRole("button", { name: "Create workspace" }).click();
await page.waitForURL(/\/app\/imports/);

const files = [
  ["suppliers", "1_suppliers.csv"],
  ["products", "2_products.csv"],
  ["stock_snapshot", "3_closing_stock.csv"],
  ["sales", "4_sales_history.csv"],
  ["purchases", "5_purchase_history.csv"],
];
for (const [kind, file] of files) {
  await page.goto(`${base}/app/imports/new?kind=${kind}`);
  await page.locator('input[type="file"]').setInputFiles(path.join(dir, file));
  await page.getByRole("button", { name: "Upload and check columns" }).click();
  await page.getByRole("heading", { name: "Match your columns" }).waitFor();
  // Report how each field was mapped (what the user will see)
  const mapping = await page.$$eval("select", (sels) =>
    sels.filter((s) => s.id || s.name).map((s) => `${(document.querySelector(`label[for="${s.id}"]`)?.textContent ?? s.name).trim()} ← ${s.selectedOptions[0]?.textContent?.trim() ?? ""}`),
  );
  console.log(`\n== ${file}\n  ` + mapping.join("\n  "));
  if (kind === "products") await page.screenshot({ path: path.join(shots, "mapping.png") });
  const confirm = page.getByLabel("I have checked the highlighted columns");
  if (await confirm.count()) await confirm.check();
  await page.getByRole("button", { name: "Check rows" }).click();
  const importBtn = page.getByRole("button", { name: /^Import \d+ rows/ });
  await importBtn.waitFor({ timeout: 120_000 });
  const ready = await page.locator("#main, main, body").first().innerText();
  const m = ready.match(/(\d[\d,]*) rows? (ready|with problems)[^\n]*/gi);
  console.log("  check:", (m ?? []).join(" | "), "| button:", await importBtn.innerText());
  await importBtn.click();
  await page.getByRole("heading", { name: "Import complete" }).waitFor({ timeout: 180_000 });
  const done = await page.locator("#main, main, body").first().innerText();
  console.log("  result:", done.split("\n").filter((l) => /created|updated|added|changed|skipped|duplicate|error/i.test(l)).slice(0, 8).join(" | "));
}

const snap = async (url, name, opts = {}) => {
  await page.goto(`${base}${url}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(shots, name), ...opts });
  return page.locator("#main, main, body").first().innerText();
};
const dash = await snap("/app/dashboard", "dashboard.png");
console.log("\n== DASHBOARD\n" + dash.slice(0, 2500));
console.log("\n== LOW\n" + (await snap("/app/analytics?view=low", "low-stock.png")).slice(0, 2500));
console.log("\n== REORDER/PURCHASING\n" + (await snap("/app/purchasing", "purchasing.png")).slice(0, 3000));
console.log("\n== NON-MOVING\n" + (await snap("/app/analytics?view=non_moving", "non-moving.png")).slice(0, 1500));
console.log("\n== EXCESS\n" + (await snap("/app/analytics?view=excess", "excess.png")).slice(0, 1500));
console.log("\n== SLOW\n" + (await snap("/app/analytics?view=slow", "slow.png")).slice(0, 1500));
await page.goto(`${base}/app/reports`);
await page.getByRole("button", { name: "Generate report" }).click();
await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}/, { timeout: 120_000 });
await page.waitForLoadState("networkidle");
await page.screenshot({ path: path.join(shots, "report.png") });
console.log("\n== REPORT\n" + (await page.locator("#main, main, body").first().innerText()).slice(0, 2500));
await page.goto(`${base}/app/assistant`);
await page.getByRole("textbox").first().fill("What should I reorder this week?");
await page.getByRole("button", { name: /Ask/ }).first().click();
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(shots, "assistant.png") });
console.log("\n== ASSISTANT\n" + (await page.locator("#main, main, body").first().innerText()).slice(0, 1500));
console.log("\nlogin:", email);
await browser.close();
