import { expect, test } from "@playwright/test";
import { fixture, salesCsv, signIn, signUp, uploadImport } from "./helpers";

/**
 * End-to-end: register → create business → import items, stock (fixing a mapping) and sales → dashboard →
 * purchase list → draft PO → invoice review → weekly report → assistant.
 * Uses only synthetic test data.
 */
test.describe.configure({ mode: "serial" });

const email = `e2e-${Date.now()}@test.local`;

test("register, create a business and import data", async ({ page }) => {
  await signUp(page, email);
  await page.getByLabel("Business name").fill("E2E Hardware Mart");
  await page.getByLabel("What do you sell?").selectOption("hardware");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app\/imports\?welcome=1/);
  await expect(page.getByText("E2E Hardware Mart is ready")).toBeVisible();

  // 1. Product master — headings are on row 3 below a title row
  await uploadImport(page, "Product master", fixture("products.csv"));
  await expect(page.getByLabel(/^SKU \/ Item code/)).toHaveValue("0");
  const confirm = page.getByLabel("I have checked the highlighted columns");
  if (await confirm.count()) await confirm.check();
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(page.getByText("Ready to import")).toBeVisible();
  await page.getByRole("button", { name: /^Import 6 rows/ }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  await expect(page.getByText("Products created")).toBeVisible();

  // 2. Stock balances — the quantity column is called "Godown Qty", so the user must pick it
  await uploadImport(page, "Stock balances", fixture("stock.csv"));
  const qty = page.getByLabel(/^Quantity on hand/);
  await expect(qty).toHaveValue("");
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(page.getByText(/Choose a column for: Quantity on hand/)).toBeVisible();
  await qty.selectOption({ label: "Godown Qty" });
  const confirm2 = page.getByLabel("I have checked the highlighted columns");
  if (await confirm2.count()) await confirm2.check();
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(page.getByText("Ready to import")).toBeVisible();
  await page.getByRole("button", { name: /^Import 6 rows/ }).click();
  await expect(page.getByText("Stock levels changed")).toBeVisible();

  // 3. Sales history
  await uploadImport(page, "Sales history", { name: "sales-register.csv", mimeType: "text/csv", buffer: salesCsv() });
  const confirm3 = page.getByLabel("I have checked the highlighted columns");
  if (await confirm3.count()) await confirm3.check();
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(page.getByText("Sales are used to measure demand")).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ rows/ }).click();
  await expect(page.getByText("Sales lines added")).toBeVisible();
});

test("dashboard and low-stock views reflect the imported data", async ({ page }) => {
  await signIn(page, email);
  await expect(page.getByRole("link", { name: /^Active products 6/ })).toBeVisible();
  // Paint brushes were counted as 0 → out of stock; screwdriver sets never sold → non-moving
  await page.getByRole("link", { name: /^Out of stock 1/ }).click();
  await expect(page).toHaveURL(/view=out/);
  await expect(page.getByRole("link", { name: "Paint Brush 2 inch" })).toBeVisible();
  await page.goto("/app/analytics?view=non_moving");
  await expect(page.getByRole("link", { name: "Screwdriver Set 6pc" })).toBeVisible();
  await page.goto("/app/analytics?view=low");
  await expect(page.getByRole("link", { name: "Measuring Tape 5m" })).toBeVisible();
});

test("purchase list → draft PO → PDF → mark sent → receive goods", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/app/purchasing");
  await expect(page.getByRole("heading", { name: "Purchase list" })).toBeVisible();
  // Imported products named their supplier, so items are grouped under it
  const createBtn = page.getByRole("button", { name: /Create draft PO for Test Tools Supplier/ });
  await expect(createBtn).toBeVisible();
  await createBtn.click();
  await expect(page).toHaveURL(/\/app\/purchase-orders\/[0-9a-f-]+\?created=1/);
  await expect(page.getByText(/Draft PO-0001 created/)).toBeVisible();

  const pdf = await page.request.get(page.url().replace("/app/purchase-orders/", "/api/purchase-orders/").replace("?created=1", "/pdf"));
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText("Its quantities now count as stock on order")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Receive goods" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm receipt and update stock" }).click();
  await expect(page.getByText(/Stock updated for 3 item/)).toBeVisible();
  await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("GRN-0001")).toBeVisible();
});

test("review a sample supplier invoice and receive it into stock", async ({ page }) => {
  await signIn(page, email);
  const sample = await page.request.get("/api/invoices/sample");
  expect(sample.status()).toBe(200);
  const pdf = await sample.body();
  await page.goto("/app/invoices");
  await page.locator('input[type="file"]').setInputFiles({ name: "sample-invoice.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Upload and read" }).click();
  await expect(page.getByRole("heading", { name: /Invoice SMP\// })).toBeVisible();
  await expect(page.getByText("Line amounts and totals reconcile.")).toBeVisible();
  // every line was matched to an existing product
  await expect(page.getByText(/line\(s\) still need a product/)).toHaveCount(0);
  await page.getByRole("button", { name: "Create goods receipt" }).click();
  await expect(page.getByRole("heading", { name: /Goods receipt GRN-/ })).toBeVisible();
  await expect(page.getByText("Draft — stock has not changed yet")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and add to stock" }).click();
  await expect(page.getByText(/item\(s\) added to stock/)).toBeVisible();
});

test("generate a weekly report with PDF and CSV exports", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/app/reports");
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect(page.getByRole("heading", { name: /Inventory report/ })).toBeVisible();
  await expect(page.getByText("Assumptions behind these numbers")).toBeVisible();
  const pdfUrl = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfUrl!);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const csvUrl = await page.getByRole("link", { name: "CSV" }).first().getAttribute("href");
  const csv = await page.request.get(csvUrl!);
  expect(await csv.text()).toContain("SKU");
});

test("ask the assistant a question grounded in the imported data", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/app/assistant");
  await page.getByLabel("Your question").fill("Which products have not sold in 90 days?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("In stock with no sales in the last 90 days")).toBeVisible();
  await expect(page.getByRole("link", { name: "Screwdriver Set 6pc" })).toBeVisible();
});
