import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const PRESET_PORT = PORT + 1;
// The presets ship with the template; an owner may delete them once the store is theirs.
const HAS_PRESETS = existsSync("content/presets/servicios.json");
// By default Playwright uses the browser it downloads itself (`npx playwright install chromium`).
// To use a Chromium that is already on the machine, point PLAYWRIGHT_CHROMIUM_PATH at it.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  // The tests share one server and one data folder: run them in order.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    locale: "es-AR",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", testIgnore: /preset\.spec/, use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testIgnore: /preset\.spec/, use: { ...devices["iPhone 13"], browserName: "chromium" } },
    ...(HAS_PRESETS ? [
      // The same store after `npm run preset servicios`, built and served from a copy (second server).
      { name: "preset-desktop", testMatch: /preset\.spec/, use: { browserName: "chromium" as const, viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${PRESET_PORT}` } },
      { name: "preset-mobile", testMatch: /preset\.spec/, use: { ...devices["iPhone 13"], browserName: "chromium" as const, baseURL: `http://localhost:${PRESET_PORT}` } },
    ] : []),
  ],
  webServer: [
    // The real thing: a fresh production build, started with `next start` on an empty data folder.
    // (Always rebuilt: pages cached by a previous run would remember products that no longer exist.)
    {
      command: "npm run build && node scripts/e2e-server.mjs",
      url: `http://localhost:${PORT}/robots.txt`,
      reuseExistingServer: false,
      timeout: 240_000,
      // CEREBRO_FIXTURES=1: the build and the servers use the store of tests/fixtures (catalogue,
      // home texts, brand, commercial rules), never the owner's — see next.config.ts.
      env: { PORT: String(PORT), DEMO_MODE: "true", CEREBRO_FIXTURES: "1" },
      // (the same command also serves PORT + 2 and PORT + 3: the store without a place to keep orders)
    },
    ...(HAS_PRESETS ? [{
      // A copy of the project with a preset applied by the real command, built and served apart
      // (WITHOUT the fixtures: it is the preset that is being looked at).
      command: "node scripts/e2e-preset-server.mjs",
      url: `http://localhost:${PRESET_PORT}/robots.txt`,
      reuseExistingServer: false,
      timeout: 360_000,
      env: { PRESET: "servicios", PRESET_PORT: String(PRESET_PORT), CEREBRO_FIXTURES: "" },
    }] : []),
  ],
});
