import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      // Local stand-in for Razorpay (API + hosted payment page) so the payment flow can be tested without network access.
      command: `MOCK_RAZORPAY_APP_URL=http://localhost:${port} node tests/e2e/mock-razorpay.mjs`,
      url: "http://localhost:3199/health",
      reuseExistingServer: true,
    },
    {
      // Production server (no file watcher). Run `npm run build` first. RATE_LIMIT_RELAXED is for this test server only.
      command: process.env.E2E_SERVER_COMMAND ?? `npx next start -p ${port}`,
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        RATE_LIMIT_RELAXED: "1",
        RAZORPAY_KEY_ID: "rzp_test_e2e",
        RAZORPAY_KEY_SECRET: "e2e_key_secret",
        RAZORPAY_WEBHOOK_SECRET: "e2e_webhook_secret",
        RAZORPAY_PLAN_IDS: "starter:plan_E2ESTARTER0001,growth:plan_E2EGROWTH00001",
        RAZORPAY_API_BASE: "http://localhost:3199/v1",
      },
    },
  ],
});
