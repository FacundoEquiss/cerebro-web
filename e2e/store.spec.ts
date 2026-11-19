import { expect, test } from "@playwright/test";
import { fillCheckout, watchConsole } from "./helpers";

test("home → product → a choice is required → cart → manual checkout → order page", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByTestId("hero-cta").click();
  await expect(page).toHaveURL(/\/tienda$/);

  // The filters live behind ONE button; the sort stays in sight.
  await expect(page.getByTestId("filters-button")).toBeVisible();
  await expect(page.getByTestId("sort-select")).toBeVisible();

  await page.getByTestId("product-card").filter({ hasText: "Camiseta básica" }).getByRole("link").click();
  await expect(page.getByTestId("product-name")).toHaveText("Camiseta básica de algodón");

  // Without choosing size and colour, nothing is added.
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("option-error")).toBeVisible();
  await expect(page.getByTestId("cart-count")).toHaveCount(0);

  // One option is still not enough.
  await page.getByTestId("option-size").getByText("M", { exact: true }).click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("option-error")).toBeVisible();
  await expect(page.getByTestId("cart-count")).toHaveCount(0);

  await page.getByTestId("option-color").getByText("Negro").click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added-notice")).toBeVisible();
  await expect(page.getByTestId("cart-count").first()).toHaveText("1");

  await page.getByTestId("view-cart").click();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-line-variant")).toHaveText("M · Negro");
  const subtotal = await page.getByTestId("cart-subtotal").innerText();

  await page.getByTestId("go-to-checkout").click();
  // An incomplete form explains what is missing and sends nothing.
  await page.getByTestId("confirm-order").click();
  await expect(page.locator("#error-name")).toBeVisible();
  await fillCheckout(page);
  await page.getByTestId("shipping-pickup").check();
  await page.getByTestId("payment-bank_transfer").check();
  await expect(page.getByTestId("checkout-total")).toHaveText(subtotal);
  await page.getByTestId("confirm-order").click();

  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page).toHaveURL(/\/pedido\/P-[A-F0-9]{10}\?t=v1\./);
  await expect(page.getByTestId("order-id")).toHaveText(/^P-[A-F0-9]{10}$/);
  await expect(page.getByTestId("order-total")).toHaveText(subtotal);
  await expect(page.getByTestId("order-status")).toHaveText("Pedido recibido");
  await expect(page.getByTestId("cart-count")).toHaveCount(0);

  // The receipt in the URL is the key: it works with no cookies at all (in-app browsers)…
  const url = page.url();
  const clean = await page.context().browser()!.newContext();
  const other = await clean.newPage();
  await other.goto(url);
  await expect(other.getByTestId("order-total")).toHaveText(subtotal);
  // …and an edited receipt opens nothing.
  await other.goto(url.replace(/.{6}$/, "AAAAAA"));
  await expect(other.getByTestId("order-problem")).toBeVisible();
  await clean.close();

  expect(errors).toEqual([]);
});

test("a product with declared options and no variants still requires a choice", async ({ page }) => {
  await page.goto("/producto/sudadera-con-capucha");
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("option-error")).toBeVisible();
  await page.getByTestId("option-size").locator("label").first().click();
  await page.getByTestId("option-color").locator("label").first().click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added-notice")).toBeVisible();
  // Two different sizes are two different lines.
  await page.getByTestId("option-size").locator("label").nth(1).click();
  await page.getByTestId("add-to-cart").click();
  await page.getByTestId("view-cart").click();
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
});

test("the server sets the total: a price sent by the browser is ignored", async ({ request }) => {
  const response = await request.post("/api/orders", {
    data: {
      idempotencyKey: "e".repeat(64),
      lines: [{ productId: "taza-de-ceramica", variantId: "taza-de-ceramica-white", quantity: 1, price: 1, unitPrice: 1 }],
      customer: { name: "Ana Ejemplo", email: "ana@example.com", phone: "+00 000 000 1000" },
      shippingMethodId: "pickup",
      paymentMethod: "bank_transfer",
      total: 1,
    },
  });
  expect(response.status()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const html = await (await request.get(url)).text();
  expect(html).toContain("11.900");
});

test("the product HTML carries name, price and structured data without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/producto/taza-de-ceramica");
  await expect(page.getByTestId("product-name")).toHaveText("Taza de cerámica");
  await expect(page.getByTestId("product-price")).toContainText("11.900");
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.some((j) => j.includes('"@type":"Product"') && j.includes('"offers"'))).toBe(true);
  expect(jsonLd.some((j) => j.includes('"@type":"BreadcrumbList"'))).toBe(true);
  await context.close();
});
