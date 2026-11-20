import { type Page } from "@playwright/test";
import { emailOf, expect, fillCheckout, login, test, watchConsole } from "./helpers";

const who = (isMobile: boolean) => (isMobile ? "Celular" : "Compu");
const key = (seed: string) => seed.repeat(64).slice(0, 64);

async function toCheckout(page: Page) {
  await page.getByTestId("view-cart").click();
  await page.getByTestId("cart-line").first().waitFor();
}

/** Opens an order in the admin panel (the board must be on screen). */
async function openOrder(page: Page, orderId: string) {
  await page.goto(`/admin?order=${orderId}`);
  await expect(page.getByTestId("order-detail")).toBeVisible();
}

test("the demo home is not a clothing store, and says what it is", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  // Only in demo mode: one block with the links to the code and to the table of businesses.
  const demo = page.getByTestId("demo-block");
  await expect(demo).toContainText("base para cualquier rubro");
  await expect(demo.getByTestId("demo-repo")).toHaveAttribute("href", /github\.com\/.+\/cerebro-web$/);
  await expect(demo.getByTestId("demo-table")).toHaveAttribute("href", /README\.es\.md#para-qué-rubros-sirve$/);
  // A mixed catalogue: every type of product on the first screen of the shop.
  const grid = page.getByTestId("product-grid");
  for (const text of ["Auriculares", "/ kg", "Con turno", "Digital", "Consultar"]) await expect(grid).toContainText(text);
  await expect(page.locator("#home-categories").locator("xpath=../..").locator("li")).toHaveCount(8);
  expect(errors).toEqual([]);
});

test("a service: choose day and time, book it, and see it in the Agenda", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Turno ${who(isMobile)}`;
  await page.goto("/producto/corte-de-pelo");
  await expect(page.getByTestId("product-kind")).toContainText("30 min");

  // Without a slot there is nothing to book.
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("option-error")).toBeVisible();

  await page.getByTestId("slot-date").selectOption({ index: 2 });
  const date = await page.getByTestId("slot-date").inputValue();
  const free = page.getByTestId("slot-picker").locator("fieldset label:not([data-off])").first();
  const time = (await free.locator("strong").innerText()).trim();
  await free.click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added-notice")).toBeVisible();

  await toCheckout(page);
  await expect(page.getByTestId("cart-line-slot")).toContainText(time);
  await expect(page.getByTestId("cart-shipping")).toHaveText("Sin envío");
  await page.getByTestId("go-to-checkout").click();

  // The checkout adapts: an appointment is not shipped, so no delivery is asked.
  await fillCheckout(page, name);
  await expect(page.getByTestId("no-shipping")).toBeVisible();
  await expect(page.getByTestId("shipping-pickup")).toHaveCount(0);
  await expect(page.getByTestId("checkout-shipping")).toHaveText("Sin envío");
  await expect(page.getByTestId("checkout-total")).toContainText("12.000");
  await page.getByTestId("payment-bank_transfer").check();
  await page.getByTestId("confirm-order").click();

  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByTestId("order-slot")).toContainText(time);
  await expect(page.getByTestId("order-total")).toContainText("12.000");
  const orderId = (await page.getByTestId("order-id").innerText()).trim();

  // The slot is taken now: nobody else can book it.
  const taken = await page.request.get(`/api/slots?product=corte-de-pelo&date=${date}`);
  expect(((await taken.json()) as { slots: { time: string; left: number }[] }).slots.find((s) => s.time === time)?.left).toBe(0);
  const second = await page.request.post("/api/orders", {
    data: { idempotencyKey: key(isMobile ? "a1" : "b2"), lines: [{ productId: "corte-de-pelo", quantity: 1, slot: `${date}T${time}` }], customer: { name: "Otra Persona", email: "otra@example.com", phone: "+00 000 000 1001" }, paymentMethod: "bank_transfer" },
  });
  expect(second.status()).toBe(409);
  expect(await second.json()).toMatchObject({ error: "slot_taken" });

  // The owner sees it in the Agenda: week and day, and from there opens the order.
  await login(page);
  await page.getByTestId("admin-nav-agenda").click();
  await page.goto(`/admin/agenda?view=week&date=${date}`);
  await expect(page.getByTestId("agenda")).toHaveAttribute("data-view", "week");
  const booking = page.getByTestId("agenda-booking").filter({ hasText: name });
  await expect(booking).toContainText(time);
  await expect(booking).toContainText("Corte de pelo");
  await expect(booking).toContainText("Sin pagar");
  await expect(page.locator(`[data-testid="agenda-day-column"][data-date="${date}"]`).getByTestId("agenda-booking").filter({ hasText: name })).toBeVisible();

  await page.getByTestId("agenda-day").click();
  await expect(page.getByTestId("agenda")).toHaveAttribute("data-view", "day");
  await expect(page.getByTestId("agenda-day-column")).toHaveCount(1);
  await page.getByTestId("agenda-booking").filter({ hasText: name }).click();
  await expect(page.getByTestId("order-detail")).toBeVisible();
  await expect(page.getByTestId("detail-slot")).toContainText(time);
  await page.getByTestId("detail-close").click();
  await expect(page.locator(`[data-order="${orderId}"]`).getByTestId("card-slot")).toContainText(time);
  expect(errors).toEqual([]);
});

test("a digital product: no download before the payment; the admin marks it paid and the download appears", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  await page.goto("/producto/guia-en-pdf");
  await expect(page.getByTestId("product-kind")).toContainText("Digital");
  await page.getByTestId("add-to-cart").click();
  await toCheckout(page);
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, `Descarga ${who(isMobile)}`);
  await expect(page.getByTestId("no-shipping")).toBeVisible();
  await page.getByTestId("payment-bank_transfer").check();
  await page.getByTestId("confirm-order").click();

  await expect(page.getByTestId("order-page")).toBeVisible();
  const orderUrl = page.url();
  const orderId = (await page.getByTestId("order-id").innerText()).trim();
  // Not paid yet: the page promises the download and gives no link.
  await expect(page.getByTestId("downloads-pending")).toBeVisible();
  await expect(page.getByTestId("download-link")).toHaveCount(0);
  // And a link that was not signed by the server opens nothing.
  expect((await page.request.get(`/api/downloads/${orderId}/0?e=9999999999&s=forged`)).status()).toBe(403);

  // The owner confirms the transfer by hand.
  await login(page);
  await openOrder(page, orderId);
  await page.getByTestId("detail-primary").click();
  await expect(page.getByTestId("detail-payment-status")).toHaveAttribute("data-paid", "yes");

  // The same order page now offers the file — signed, expiring, private.
  await page.goto(orderUrl);
  const link = page.getByTestId("download-link");
  await expect(link).toBeVisible();
  await expect(page.getByTestId("downloads-pending")).toHaveCount(0);
  const href = (await link.getAttribute("href"))!;
  expect(href).toMatch(new RegExp(`^/api/downloads/${orderId}/0\\?e=\\d+&s=[\\w-]+$`));
  const file = await page.request.get(href);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // The file has no public address.
  expect((await page.request.get("/sample-guide.pdf")).status()).toBe(404);
  expect((await page.request.get("/downloads/sample-guide.pdf")).status()).toBe(404);
  expect((await page.request.get(href.replace(/s=.{6}/, "s=AAAAAA"))).status()).toBe(403);
  expect(errors).toEqual([]);
});

test("a quote: the customer asks, the admin prices and sends it, the customer accepts and pays by hand", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Presupuesto ${who(isMobile)}`;
  await page.goto("/producto/camisetas-estampadas-para-eventos");
  // No public price, no cart.
  await expect(page.getByTestId("product-price")).toHaveText("Consultar");
  await expect(page.getByTestId("add-to-cart")).toHaveCount(0);

  // An incomplete request explains what is missing.
  await page.getByTestId("quote-submit").click();
  await expect(page.locator("#quote-error-name")).toBeVisible();
  await page.getByTestId("quote-quantity").fill("40");
  await page.getByTestId("quote-name").fill(name);
  await page.getByTestId("quote-detail").fill("Cuarenta camisetas con nuestro logo para un evento. Entrega en dos meses.");
  await page.getByTestId("quote-email").fill(emailOf(name));
  await page.getByTestId("quote-phone").fill("+00 000 000 1000");
  await page.getByTestId("quote-submit").click();

  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recibimos tu consulta");
  await expect(page.getByTestId("order-status")).toHaveText("Consulta");
  await expect(page.getByTestId("quote-accept-form")).toHaveCount(0);
  await expect(page.getByTestId("order-total")).toHaveCount(0);
  const orderUrl = new URL(page.url());
  const orderId = (await page.getByTestId("order-id").innerText()).trim();
  const accept = (total: string) =>
    page.request.post("/api/quotes/accept", { form: { id: orderId, t: orderUrl.searchParams.get("t")!, total, payment: "bank_transfer" }, maxRedirects: 0 });

  // It cannot be accepted (or paid) before the owner sends it.
  const early = await accept("0");
  expect(early.status()).toBe(303);
  expect(early.headers().location).toContain("quote=not_sent");

  // The admin finds it in its own column, prices it and sends it.
  await login(page);
  await expect(page.getByTestId("column-quote").locator(`[data-order="${orderId}"]`)).toContainText(name);
  await expect(page.getByTestId("column-quote").locator(`[data-order="${orderId}"]`).getByTestId("card-quote")).toHaveText("Consulta");
  await openOrder(page, orderId);
  const editor = page.getByTestId("quote-editor");
  await expect(editor).toContainText("Cuarenta camisetas con nuestro logo");
  await expect(editor.getByTestId("quote-state")).toContainText("Todavía no se envió");
  // Without a price it cannot be sent.
  await editor.getByTestId("quote-send").click();
  await expect(page.getByTestId("order-detail").getByRole("alert")).toContainText("precio mayor a cero");
  await editor.getByTestId("quote-price").fill("9500");
  await editor.getByTestId("quote-shipping").fill("6000");
  await expect(editor.getByTestId("quote-preview")).toContainText("386.000");
  await editor.getByTestId("quote-send").click();
  await expect(editor.getByTestId("quote-state")).toContainText("Enviado el");
  await page.getByTestId("detail-close").click();
  await expect(page.locator(`[data-order="${orderId}"]`).getByTestId("card-quote")).toHaveText("Enviado");

  // The customer opens the link: the quote, and a way to accept it.
  await page.goto(orderUrl.toString());
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu presupuesto está listo");
  await expect(page.getByTestId("quote-total")).toContainText("386.000");
  // A total that is not the one that was sent is refused, and nothing changes.
  const tampered = await accept("1");
  expect(tampered.headers().location).toContain("quote=changed");
  await page.reload();
  await expect(page.getByTestId("order-status")).toHaveText("Consulta");

  await page.getByTestId("quote-payment-bank_transfer").check();
  await page.getByTestId("quote-accept").click();
  // Now it is a normal order, to be paid by transfer.
  await expect(page.getByTestId("order-status")).toHaveText("Pedido recibido");
  await expect(page.getByTestId("order-total")).toContainText("386.000");
  await expect(page.locator("#order-transfer")).toBeVisible();
  await expect(page.getByTestId("quote-accept-form")).toHaveCount(0);

  // …and the admin confirms the payment like any other.
  await page.goto("/admin");
  await expect(page.getByTestId("column-new").locator(`[data-order="${orderId}"]`)).toBeVisible();
  await openOrder(page, orderId);
  await page.getByTestId("detail-primary").click();
  await expect(page.getByTestId("detail-status")).toHaveText("Pagado");
  expect(errors).toEqual([]);
});

test("sale by weight: a decimal quantity, the price per kilo and a total the server rounds", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  await page.goto("/producto/mix-de-frutos-secos");
  await expect(page.getByTestId("product-price")).toContainText("19.500 / kg");
  await expect(page.getByTestId("quantity")).toHaveText("0,1 kg");
  const more = page.getByRole("button", { name: "Sumar cantidad" });
  for (let i = 0; i < 6; i++) await more.click();
  await expect(page.getByTestId("quantity")).toHaveText("0,7 kg");
  await expect(page.getByTestId("add-to-cart")).toContainText("13.650");
  await page.getByTestId("add-to-cart").click();
  await toCheckout(page);
  await expect(page.getByTestId("cart-line-quantity")).toHaveText("0,7 kg");
  await expect(page.getByTestId("cart-subtotal")).toContainText("13.650");
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, `Peso ${who(isMobile)}`);
  await page.getByTestId("shipping-pickup").check();
  await page.getByTestId("confirm-order").click();
  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByTestId("order-total")).toContainText("13.650");
  await expect(page.getByTestId("order-page")).toContainText("0,7 kg");

  // The server refuses a weight that is not a multiple of the step, whatever the browser says.
  const bad = await page.request.post("/api/orders", {
    data: { idempotencyKey: key(isMobile ? "c3" : "d4"), lines: [{ productId: "mix-de-frutos-secos", quantity: 0.25, price: 1 }], customer: { name: "Ana Ejemplo", email: "ana@example.com", phone: "+00 000 000 1000" }, shippingMethodId: "pickup", paymentMethod: "bank_transfer" },
  });
  expect(bad.status()).toBe(409);
  expect(await bad.json()).toMatchObject({ error: "quantity" });
  expect(errors).toEqual([]);
});

test("a mixed cart: the shipping is asked and charged only because something physical is in it", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  await page.goto("/producto/guia-en-pdf");
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added-notice")).toBeVisible();
  await page.goto("/producto/vela-aromatica-de-soja");
  await page.getByTestId("add-to-cart").click();
  await toCheckout(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, `Mixto ${who(isMobile)}`);
  await expect(page.getByTestId("mixed-note")).toBeVisible();
  await page.getByTestId("shipping-delivery").check();
  await page.getByTestId("checkout-address").fill("Calle de Ejemplo 123");
  await page.getByTestId("checkout-city").fill("Ciudad de Ejemplo");
  await page.getByTestId("checkout-postalCode").fill("0000");
  // 7.900 (download) + 13.200 (candle) + 6.500 (delivery, once).
  await expect(page.getByTestId("checkout-total")).toContainText("27.600");
  await page.getByTestId("confirm-order").click();
  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByTestId("order-total")).toContainText("27.600");
  await expect(page.getByTestId("downloads-pending")).toBeVisible();
  expect(errors).toEqual([]);
});

test("feeds list physical products only; each type has its own structured data", async ({ request }) => {
  for (const feed of ["/feeds/google.xml", "/feeds/meta.xml"]) {
    const xml = await (await request.get(feed)).text();
    expect(xml).toContain("<g:id>auriculares-inalambricos</g:id>");
    expect(xml).toContain("<g:unit_pricing_measure>1 kg</g:unit_pricing_measure>");
    for (const id of ["corte-de-pelo", "guia-en-pdf", "camisetas-estampadas-para-eventos", "clase-grupal-de-yoga"]) expect(xml).not.toContain(`<g:id>${id}</g:id>`);
  }
  const ld = async (slug: string) => {
    const html = await (await request.get(`/producto/${slug}`)).text();
    return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>).find((j) => j["@type"] === "Product" || j["@type"] === "Service")!;
  };
  expect(await ld("corte-de-pelo")).toMatchObject({ "@type": "Service", offers: { price: "12000.00" } });
  expect(await ld("guia-en-pdf")).toMatchObject({ "@type": "Product", offers: { price: "7900.00" } });
  const quote = await ld("camisetas-estampadas-para-eventos");
  expect(quote["@type"]).toBe("Product");
  expect(quote).not.toHaveProperty("offers");
  expect(await ld("cafe-en-grano")).toMatchObject({ offers: { priceSpecification: { "@type": "UnitPriceSpecification", referenceQuantity: { unitText: "kg" } } } });
});
