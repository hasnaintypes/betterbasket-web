import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "catalog.spec.mjs",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3106",
    browserName: "chromium",
    launchOptions: {
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  webServer: [
    {
      command: "node scripts/catalog-stub.mjs",
      url: "http://127.0.0.1:4900/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec next dev -p 3106",
      url: "http://127.0.0.1:3106/",
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4900",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3106",
      },
    },
  ],
});
