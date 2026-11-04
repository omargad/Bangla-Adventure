import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

// A private, new database for this run; never accepts production or user credentials.
if (!process.env.BANGLA_DEMO_E2E_DB) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-demo-screens-"));
  process.env.BANGLA_DEMO_E2E_DB = path.join(dir, "demo.db");
  process.env.BANGLA_DEMO_E2E_PASSWORD = randomBytes(32).toString("base64url");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-connected-demo.ts", "--local", "--apply"], {
    env: { ...process.env, DATABASE_PATH: process.env.BANGLA_DEMO_E2E_DB, DEMO_LOCAL_PASSWORD: process.env.BANGLA_DEMO_E2E_PASSWORD }, stdio: "pipe",
  });
}
if (!process.env.BANGLA_DEMO_E2E_DB.startsWith(path.join(os.tmpdir(), "bangla-demo-screens-")) || !process.env.BANGLA_DEMO_E2E_PASSWORD) throw new Error("Isolated demo screenshot state is required.");

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "connected-demo.spec.ts", workers: 1, retries: 0,
  outputDir: "test-results/connected-demo", reporter: "list", timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:3260", viewport: { width: 1440, height: 1000 },
    browserName: "chromium", trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "npm run start -- -H 127.0.0.1 -p 3260", url: "http://127.0.0.1:3260/api/health", reuseExistingServer: false,
    env: { DATABASE_PATH: process.env.BANGLA_DEMO_E2E_DB, PLATFORM_MODE: "legacy", NODE_ENV: "production" }, timeout: 60_000,
  },
});
