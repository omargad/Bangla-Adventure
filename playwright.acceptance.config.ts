import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const state = process.env.BANGLA_ACCEPTANCE_DB ? path.dirname(process.env.BANGLA_ACCEPTANCE_DB) : path.join(os.tmpdir(), `bangla-acceptance-${process.pid}`);
if (!path.resolve(state).startsWith(path.join(os.tmpdir(), "bangla-acceptance-"))) throw new Error("Acceptance requires a fresh temporary database.");
const database = path.join(state, "acceptance.db");
process.env.BANGLA_ACCEPTANCE_DB = database;

export default defineConfig({
  testDir: "./tests/acceptance", fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: !!process.env.CI, timeout: 240_000, reporter: "line",
  use: { baseURL: "http://127.0.0.1:3211", trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {} } }],
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD === "1" ? "" : "npm run build && "}npm run start -- -H 127.0.0.1 -p 3211`,
    url: "http://127.0.0.1:3211", reuseExistingServer: false, timeout: 240_000,
    env: { NEXT_DIST_DIR: process.env.ACCEPTANCE_DIST_DIR ?? ".next-acceptance", PLATFORM_MODE: "legacy", DATABASE_PATH: database, MEDIA_ROOT: path.join(state, "media"), NODE_ENV: "production" },
  },
});
