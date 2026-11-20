import { expect, test, watchConsole } from "./helpers";

// This server is a COPY of the project where `node scripts/preset.mjs servicios` was run before
// building (scripts/e2e-preset-server.mjs). The main server still shows the mixed demo.
test("after `npm run preset servicios` the store is a different store", async ({ page, request }) => {
  const errors = watchConsole(page);
  await page.goto("/");

  // The home texts of the preset…
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reservá tu turno en un minuto");
  await expect(page.getByText("Estudio de ejemplo").first()).toBeVisible();
  await expect(page.getByTestId("hero-cta")).toContainText("Ver servicios");
  // …its palette (config/brand.ts)…
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--action").trim())).toBe("#5b3f8f");
  // …and its catalogue: services, not the mixed demo.
  await page.getByTestId("hero-cta").click();
  const cards = page.getByTestId("product-card");
  await expect(cards).toHaveCount(7);
  // …one of them an event with fixed dates.
  await expect(cards.filter({ hasText: "Taller intensivo" })).toContainText("Con fecha");
  await expect(cards.filter({ hasText: "Corte de pelo" })).toBeVisible();
  await expect(cards.filter({ hasText: "Clase grupal de yoga" })).toBeVisible();
  await expect(cards.filter({ hasText: "Camiseta" })).toHaveCount(0);
  expect((await request.get("/producto/camiseta-basica-algodon")).status()).toBe(404);
  expect((await request.get("/producto/corte-de-pelo")).status()).toBe(200);

  // A real store: the demo block is not there.
  await page.goto("/");
  await expect(page.getByTestId("demo-block")).toHaveCount(0);

  // And the service can be booked there too.
  await page.goto("/producto/color-y-brushing");
  await expect(page.getByTestId("slot-picker")).toBeVisible();
  await expect(page.getByTestId("product-kind")).toContainText("90 min");

  expect(errors).toEqual([]);
});
