import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
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
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  // The real thing: a fresh production build, started with `next start` on an empty data folder.
  // (Always rebuilt: pages cached by a previous run would remember products that no longer exist.)
  webServer: {
    command: "npm run build && node scripts/e2e-server.mjs",
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { PORT: String(PORT) },
  },
});
