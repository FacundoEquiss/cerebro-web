#!/usr/bin/env node
// Walks the store and the admin panel in a real browser, on a computer (1440 × 900) and on a
// phone, and saves a screenshot of every key screen. It also fails if any page logs a console
// error. Needs the site running on an empty data folder:
//   npm run build && node scripts/e2e-server.mjs
//
//   SCREENSHOT_DIR=./shots BASE_URL=http://localhost:3100 npm run screenshots
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, devices } from "@playwright/test";
import { E2E_ADMIN } from "./e2e-server.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const out = resolve(process.env.SCREENSHOT_DIR ?? "screenshots");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
mkdirSync(out, { recursive: true });

const targets = [
  { name: "desktop", context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: "mobile", context: { ...devices["iPhone 13"], deviceScaleFactor: 2 } },
];

const browser = await chromium.launch({ executablePath });
const problems = [];

for (const target of targets) {
  const context = await browser.newContext({ ...target.context, locale: "es-AR" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[${target.name}] console: ${m.text()} (${page.url()})`));
  page.on("pageerror", (e) => problems.push(`[${target.name}] page error: ${e.message} (${page.url()})`));
  const shot = async (name, options = {}) => {
    if (options.fullPage) {
      // Walk down the page first, so images that load lazily are in the picture.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `${target.name}-${name}.png`), ...options });
  };
  const go = (path) => page.goto(`${base}${path}`, { waitUntil: "networkidle" });

  await go("/");
  await shot("01-home", { fullPage: true });
  await page.getByTestId("hero-cta").click();
  await page.waitForURL(/tienda|shop/);
  await shot("02-shop");
  await page.getByTestId("filters-button").click();
  await shot("02b-shop-filters");
  await page.keyboard.press("Escape");

  await page.getByTestId("product-card").first().getByRole("link").click();
  await page.getByTestId("product-name").waitFor();
  await page.getByTestId("add-to-cart").click();
  await shot("03-product-choose-first");
  for (const option of await page.locator("fieldset[data-testid^='option-']").all()) {
    await option.locator("label:not([data-off])").first().click();
  }
  await page.getByTestId("add-to-cart").click();
  await page.getByTestId("added-notice").waitFor();
  await shot("03-product", { fullPage: target.name === "desktop" });

  await page.getByTestId("view-cart").click();
  await page.getByTestId("cart-line").waitFor();
  await shot("04-cart");
  await page.getByTestId("go-to-checkout").click();
  await page.getByTestId("checkout-form").waitFor();
  await page.getByTestId("checkout-name").fill("Ana Ejemplo");
  await page.getByTestId("checkout-email").fill("ana@example.com");
  await page.getByTestId("checkout-phone").fill("+00 000 000 1000");
  await shot("05-checkout", { fullPage: true });
  await page.getByTestId("confirm-order").click();
  await page.getByTestId("order-page").waitFor();
  await shot("06-order", { fullPage: true });

  await go("/admin/login");
  await shot("07-admin-login");
  await page.getByTestId("login-email").fill(E2E_ADMIN.email);
  await page.getByTestId("login-password").fill(E2E_ADMIN.password);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("kanban").waitFor();
  await shot("08-admin-kanban");
  await page.getByTestId("order-card").first().click();
  await page.getByTestId("order-detail").waitFor();
  await shot("09-admin-order-detail");
  await page.getByTestId("detail-close").click();
  await go("/admin/summary");
  await shot("10-admin-summary", { fullPage: true });
  await go("/admin/products");
  await shot("11-admin-products");
  await page.getByTestId("product-row").first().getByRole("link").click();
  await page.getByTestId("product-form").waitFor();
  await shot("12-admin-product-edit", { fullPage: true });
  await go("/admin/customers");
  await shot("13-admin-customers");
  await go("/admin/settings");
  await shot("14-admin-settings", { fullPage: true });
  await context.close();
}

await browser.close();
if (problems.length > 0) {
  console.error(`✗ ${problems.length} console problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log(`✓ screenshots saved to ${out} — no console errors`);
