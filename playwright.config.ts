import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const systemChrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const isolatedSettingsPath = path.join(
  os.tmpdir(),
  `astro-ai-locator-playwright-${process.pid}.json`
);
const fixtureUrl = "http://127.0.0.1:45173";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  webServer: {
    command:
      "npx astro dev --root tests/fixtures/basic --host 127.0.0.1 --port 45173",
    url: fixtureUrl,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ASTRO_DEV_BACKGROUND: "0",
      ASTRO_AI_LOCATOR_SETTINGS_PATH: isolatedSettingsPath
    }
  },
  use: {
    baseURL: fixtureUrl,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(existsSync(systemChrome)
          ? { launchOptions: { executablePath: systemChrome } }
          : {})
      }
    }
  ]
});
