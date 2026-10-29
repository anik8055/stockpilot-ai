import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const fixture = (name: string) => path.join(process.cwd(), "tests", "fixtures", name);

/** Synthetic item-wise sales for the last 90 days, generated relative to today so demand is always "current". */
export function salesCsv(): Buffer {
  const rates: Record<string, [number, number]> = {
    "HW-HAM-500": [299, 0.8],
    "HW-TAPE-5M": [140, 1.2],
    "HW-DRL-13": [2600, 0.05],
    "HW-NAIL-2": [120, 3],
    "HW-PAINT-BR": [55, 1.5],
  };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const rows = ["Date,Invoice No,Item Code,Qty,Rate,Amount"];
  let n = 1;
  for (let d = 90; d >= 1; d--) {
    const day = new Date(Date.now() - d * 86400000);
    const ds = `${String(day.getDate()).padStart(2, "0")}/${String(day.getMonth() + 1).padStart(2, "0")}/${day.getFullYear()}`;
    for (const [sku, [rate, mean]] of Object.entries(rates)) {
      let q = 0;
      for (let i = 0; i < 6; i++) if (rand() < mean / 6) q++;
      if (q) rows.push(`${ds},INV-${n++},${sku},${q},${rate},${q * rate}`);
    }
  }
  return Buffer.from(rows.join("\n") + "\n");
}

export async function signUp(page: Page, email: string, password = "e2e-Password-2026") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

const KINDS: Record<string, string> = { "Product master": "products", "Stock balances": "stock_snapshot", "Sales history": "sales", "Purchase history": "purchases", "Supplier list": "suppliers" };

export async function uploadImport(page: Page, kindLabel: string, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto(`/app/imports/new?kind=${KINDS[kindLabel]}`);
  await expect(page.getByRole("heading", { name: new RegExp(kindLabel) })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Upload and check columns" }).click();
  await expect(page.getByRole("heading", { name: "Match your columns" })).toBeVisible();
}
