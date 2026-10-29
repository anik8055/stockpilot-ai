import type { CapacitorConfig } from "@capacitor/cli";

/**
 * StockPilot is server-rendered, so the Android app loads the deployed HTTPS site.
 * Set CAP_SERVER_URL to your production URL before `npx cap sync android` (never an http:// URL in release builds).
 * The bundled mobile/www page is shown only when the server cannot be reached.
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID ?? "in.example.stockpilot", // placeholder — replace with your reverse-domain ID before publishing
  appName: "StockPilot AI",
  webDir: "mobile/www",
  server: serverUrl
    ? {
        url: serverUrl,
        errorPath: "index.html",
        allowNavigation: [new URL(serverUrl).host],
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: process.env.CAP_DEBUG === "1",
  },
};

export default config;
