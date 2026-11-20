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

test("the demo home shows many lines of business, and says what it is", async ({ page }) => {
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
  // No mail provider in this server: the panel does not claim an e-mail went out, and hands the
  // owner the customer's link — to copy, or to send by WhatsApp.
  await expect(editor.getByTestId("quote-note")).toContainText("NO se le envió ningún e-mail");
  const link = await editor.getByTestId("quote-link").inputValue();
  expect(link).toMatch(new RegExp(`/pedido/${orderId}\\?t=v1\\.`));
  await expect(editor.getByTestId("quote-link-copy")).toBeVisible();
  const whatsappHref = (await editor.getByTestId("quote-link-whatsapp").getAttribute("href"))!;
  expect(whatsappHref).toMatch(/^https:\/\/wa\.me\/0+1000\?text=/); // the customer's own phone
  // (Each link is signed when it is made, so two of them differ in their expiry: compare the order.)
  expect(decodeURIComponent(whatsappHref)).toContain(link.split("?t=")[0]! + "?t=v1.");
  await page.getByTestId("detail-close").click();
  await expect(page.locator(`[data-order="${orderId}"]`).getByTestId("card-quote")).toHaveText("Enviado");

  // The customer opens the link the owner passed on: the quote, and a way to accept it.
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu presupuesto está listo");
  await expect(page.getByTestId("quote-total")).toContainText("386.000");
  // A total that is not the one that was sent is refused, and nothing changes.
  const tampered = await accept("1");
  expect(tampered.headers().location).toContain("quote=changed");
  await page.reload();
  await expect(page.getByTestId("order-status")).toHaveText("Consulta");

  // The quote charges shipping, so it asks where to deliver — and is not accepted without it.
  await expect(page.getByTestId("quote-address")).toBeVisible();
  const noAddress = await page.request.post("/api/quotes/accept", { form: { id: orderId, t: new URL(link).searchParams.get("t")!, total: "386000", payment: "bank_transfer" }, maxRedirects: 0 });
  expect(noAddress.headers().location).toContain("quote=address");
  await page.getByTestId("quote-address-line").fill("Calle de Ejemplo 123");
  await page.getByTestId("quote-address-city").fill("Ciudad de Ejemplo");
  await page.getByTestId("quote-address-postal").fill("0000");
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
  await expect(page.getByTestId("order-detail")).toContainText("Calle de Ejemplo 123");
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

test("an event: the admin loads fixed dates and places, people sign up, and it shows in the Agenda", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Taller de prueba ${who(isMobile)}`;
  const slug = `taller-de-prueba-${who(isMobile).toLowerCase()}`;
  const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  // The owner creates it in the panel: a service WITH DATES is an event.
  await login(page);
  await page.goto("/admin/products");
  await page.getByTestId("new-product").click();
  await page.getByTestId("p-name").fill(name);
  await page.getByTestId("p-description").fill("Un taller presencial con cupo limitado. Creado por la prueba automática.");
  await page.getByTestId("p-category").selectOption("servicios");
  await page.getByTestId("p-price").fill("32000");
  await page.getByTestId("p-type").selectOption("service");
  await page.getByTestId("p-duration").fill("120");
  await page.getByTestId("p-capacity").fill("2");
  await page.getByTestId("p-agenda").selectOption("event");
  // The second date is shorter than the rest (45 minutes), and one is typed twice by mistake.
  await page.getByTestId("p-sessions").fill(`${day(20)} 10:00\n${day(48)} 18:30 45\n${day(20)} 10:00`);
  await page.getByTestId("p-save").click();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${slug}$`));

  // In the store it is joined, not "booked": a list of dates with the places left.
  await page.goto(`/producto/${slug}`);
  await expect(page.getByTestId("product-kind")).toContainText("Con fecha");
  await expect(page.getByTestId("product-kind")).toContainText("lugares limitados");
  const picker = page.getByTestId("slot-picker");
  await expect(picker).toHaveAttribute("data-event", /.*/);
  await expect(picker.getByTestId("session")).toHaveCount(2);
  await expect(picker.getByTestId("session-left").first()).toHaveText("Quedan 2 lugares");
  await expect(page.getByTestId("slot-date")).toHaveCount(0); // no weekly calendar
  await expect(page.getByTestId("add-to-cart")).toHaveText("Inscribirme");
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("option-error")).toHaveText("Elegí una fecha para inscribirte.");
  await picker.locator("label").first().click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added-notice")).toContainText("Inscripción agregada");
  await toCheckout(page);
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, name);
  await expect(page.getByTestId("no-shipping")).toBeVisible();
  await page.getByTestId("confirm-order").click();
  await expect(page.getByTestId("order-slot")).toContainText("10:00");

  // One place less on that date, the other date untouched.
  await page.goto(`/producto/${slug}`);
  await expect(picker.getByTestId("session-left").first()).toHaveText("Queda 1 lugar");
  await expect(picker.getByTestId("session-left").nth(1)).toHaveText("Quedan 2 lugares");
  // Three people cannot take the place that is left.
  const full = await page.request.post("/api/orders", { data: { idempotencyKey: key(isMobile ? "e5" : "f6"), lines: [{ productId: slug, quantity: 2, slot: `${day(20)}T10:00` }], customer: { name: "Otra Persona", email: "otra.evento@example.com", phone: "+00 000 000 1001" }, paymentMethod: "bank_transfer" } });
  expect(await full.json()).toMatchObject({ error: "slot_taken" });
  // Search engines get an Event per date.
  const html = await (await page.request.get(`/producto/${slug}`)).text();
  expect(html).toContain('"@type":"Event"');
  expect(html).toContain(`"startDate":"${day(20)}T`);

  // From today's Agenda the date is one step away: the date box, or «next event».
  await page.goto("/admin/agenda?view=day");
  await expect(page.getByTestId("agenda-next-event")).toBeVisible();
  await page.getByTestId("agenda-date").fill(day(20));
  await page.getByTestId("agenda-go").click();
  await expect(page).toHaveURL(new RegExp(`date=${day(20)}`));
  const booking = page.getByTestId("agenda-booking").filter({ hasText: name });
  await expect(booking).toHaveCount(1);
  await expect(booking).toContainText("10:00");
  // The date is written in the language's own way: only the first letter in capitals.
  await expect(page.getByTestId("agenda-range")).toHaveText(/^[A-ZÁÉÍÓÚ][a-záéíóúñ]+, \d{1,2} de [a-záéíóúñ]+$/);

  // Back in the editor: the length of the second date was kept, the repeated line is one date.
  await page.goto(`/admin/products/${slug}`);
  await expect(page.getByTestId("p-sessions")).toHaveValue(`${day(20)} 10:00\n${day(48)} 18:30 45`);
  const sessions = (await (await page.request.get(`/api/slots?product=${slug}`)).json()) as { sessions: { start: string; end: string }[] };
  expect(sessions.sessions.map((x) => (Date.parse(x.end) - Date.parse(x.start)) / 60_000)).toEqual([120, 45]);
  // Taking away every date does NOT turn it into a weekly service: it is an event with no open
  // dates. And the owner is told that the date that went had a sign-up.
  await page.getByTestId("p-sessions").fill("");
  await expect(page.getByTestId("p-no-dates")).toContainText("Sin fechas abiertas");
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-moved")).toContainText(`${day(20)} 10:00`);
  await page.goto(`/producto/${slug}`);
  await expect(page.getByTestId("product-kind")).toContainText("Con fecha");
  await expect(page.getByTestId("no-dates")).toBeVisible();
  await expect(page.getByTestId("slot-date")).toHaveCount(0);

  // A rule that repeats — every week on that weekday — gives the next dates on its own.
  await page.goto(`/admin/products/${slug}`);
  await expect(page.getByTestId("p-agenda")).toHaveValue("event");
  await page.getByTestId("p-repeat-week").selectOption("every");
  await page.getByTestId("p-repeat-weekday").selectOption("sat");
  await page.getByTestId("p-repeat-time").fill("10:00");
  await page.getByTestId("p-repeat-count").fill("4");
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-saved")).toBeVisible();
  await page.goto(`/producto/${slug}`);
  await expect(picker.getByTestId("session")).toHaveCount(4);
  await expect(picker.locator("label strong").first()).toHaveText(/^Sábado, \d{1,2} de [a-záéíóúñ]+ · 10:00$/);

  // «Saltear estas fechas»: the owner takes one date of the rule out, and the next one opens.
  const offered = ((await (await page.request.get(`/api/slots?product=${slug}`)).json()) as { sessions: { slot: string }[] }).sessions.map((x) => x.slot);
  await page.goto(`/admin/products/${slug}`);
  await page.getByTestId("p-skip").fill(offered[0]!.slice(0, 10));
  // A single date on a skipped day is named before saving: the skipped day wins.
  await page.getByTestId("p-sessions").fill(`${offered[0]!.replace("T", " ")}`);
  await expect(page.getByTestId("p-skipped-sessions")).toContainText(offered[0]!.replace("T", " "));
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-saved")).toBeVisible();
  const after = ((await (await page.request.get(`/api/slots?product=${slug}`)).json()) as { sessions: { slot: string }[] }).sessions.map((x) => x.slot);
  expect(after).toHaveLength(4);
  expect(after).not.toContain(offered[0]);
  expect(after.slice(0, 3)).toEqual(offered.slice(1));
  await page.goto(`/admin/products/${slug}`);
  await expect(page.getByTestId("p-skip")).toHaveValue(offered[0]!.slice(0, 10));
  expect(errors).toEqual([]);
});

test("a draft: a product without a price is in the panel as «Falta el precio» and nowhere in the store", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Aceite de prueba ${who(isMobile)}`;
  const slug = `aceite-de-prueba-${who(isMobile).toLowerCase()}`;
  await login(page);
  await page.goto("/admin/products");
  await page.getByTestId("new-product").click();
  await page.getByTestId("p-name").fill(name);
  await page.getByTestId("p-description").fill("Aceite de oliva. Todavía no sabemos el precio.");
  await page.getByTestId("p-category").selectOption("almacen");
  // No price is typed and none is invented: it is saved as a draft.
  await page.getByTestId("p-draft").check();
  await page.getByTestId("p-save").click();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${slug}$`));

  await page.goto("/admin/products");
  await page.getByTestId("products-search").fill(name);
  await expect(page.getByTestId("product-row").getByTestId("draft-pill")).toHaveText("Falta el precio");

  // For the store it does not exist: no page, no card, no search result, no feed row, no order.
  expect((await page.request.get(`/producto/${slug}`)).status()).toBe(404);
  await page.goto("/tienda/almacen");
  await expect(page.getByTestId("product-card").filter({ hasText: name })).toHaveCount(0);
  expect(await (await page.request.get(`/buscar?q=${encodeURIComponent(name)}`)).text()).not.toContain(slug);
  for (const path of ["/feeds/google.xml", "/sitemap.xml", "/llms.txt"]) expect(await (await page.request.get(path)).text()).not.toContain(slug);
  const order = await page.request.post("/api/orders", { data: { idempotencyKey: key(isMobile ? "a7" : "b8"), lines: [{ productId: slug, quantity: 1 }], customer: { name: "Ana Ejemplo", email: emailOf(name), phone: "+00 000 000 1000" }, shippingMethodId: "pickup", paymentMethod: "bank_transfer" } });
  expect(order.status()).toBe(409);
  expect(await order.json()).toMatchObject({ error: "unknown_product" });

  // The owner gives the price: the draft mark comes off and it is on sale. The price box of a
  // draft is EMPTY (not 0), and without a price the product cannot leave the draft.
  await page.goto(`/admin/products/${slug}`);
  await expect(page.getByTestId("p-price")).toHaveValue("");
  await page.getByTestId("p-draft").uncheck();
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-error")).toContainText("Falta el precio");
  // The server is the authority: the same save sent by hand is refused too.
  const free = await page.request.post("/api/admin/products", {
    headers: { origin: new URL(page.url()).origin },
    data: { slug, id: slug, name, description: "x", category: "almacen", price: 0, compareAtPrice: null, stock: 1, featured: false, active: true, draft: false, minQuantity: 1, attributes: {}, images: [], options: [], variants: [] },
  });
  expect(free.status()).toBe(400);
  expect(await free.json()).toMatchObject({ error: "invalid", field: "price" });
  expect((await page.request.get(`/producto/${slug}`)).status()).toBe(404);
  await page.getByTestId("p-price").fill("9800");
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-saved")).toBeVisible();
  await page.goto(`/producto/${slug}`);
  await expect(page.getByTestId("product-price")).toContainText("9.800");
  expect(errors).toEqual([]);
});

test("a free product: «Gratis» in the store, nothing to pay at the checkout, and the download is handed over at once", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Guía gratis ${who(isMobile)}`;
  const slug = `guia-gratis-${who(isMobile).toLowerCase()}`;
  await login(page);
  await page.goto("/admin/products");
  await page.getByTestId("new-product").click();
  await page.getByTestId("p-name").fill(name);
  await page.getByTestId("p-description").fill("Una guía de regalo para quien se suscribe. Creada por la prueba automática.");
  await page.getByTestId("p-category").selectOption("digital");
  await page.getByTestId("p-type").selectOption("digital");
  await page.getByTestId("p-stock").fill(""); // a file does not run out
  await page.getByTestId("p-file").setInputFiles({ name: "guia-gratis.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% a free guide\n") });
  await expect(page.getByTestId("p-file-name")).toHaveValue("guia-gratis.pdf");
  // Price 0 without a word is still refused; «Gratis» is how the owner says it is on purpose.
  await page.getByTestId("p-price").fill("0");
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-error")).toContainText("Falta el precio");
  await page.getByTestId("p-free").check();
  await expect(page.getByTestId("p-price")).toBeDisabled();
  await page.getByTestId("p-save").click();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${slug}$`));
  await expect(page.getByTestId("p-free")).toBeChecked();

  // The store says «Gratis», never «$ 0».
  await page.goto("/tienda/digital");
  const card = page.getByTestId("product-card").filter({ hasText: name });
  await expect(card.locator("[data-free]")).toHaveText("Gratis");
  await page.goto(`/producto/${slug}`);
  await expect(page.getByTestId("product-price")).toHaveText("Gratis");
  expect(await (await page.request.get(`/producto/${slug}`)).text()).toContain('"price":"0.00"');
  expect(await (await page.request.get("/feeds/google.xml")).text()).not.toContain(slug);

  await page.getByTestId("add-to-cart").click();
  await toCheckout(page);
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, name);
  // No way of paying is asked: there is nothing to pay.
  await expect(page.getByTestId("checkout-free")).toBeVisible();
  await expect(page.getByTestId("payment-bank_transfer")).toHaveCount(0);
  await expect(page.getByTestId("checkout-total")).toHaveText("Gratis");
  await page.getByTestId("confirm-order").click();

  // Confirmed at once, with the file — nobody has to mark a payment of nothing.
  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Listo: es gratis");
  await expect(page.getByTestId("downloads-pending")).toHaveCount(0);
  const link = page.getByTestId("download-link");
  await expect(link).toBeVisible();
  const file = await page.request.get((await link.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const orderId = (await page.getByTestId("order-id").innerText()).trim();
  await openOrder(page, orderId);
  await expect(page.getByTestId("detail-payment-status")).toHaveAttribute("data-paid", "yes");
  expect(errors).toEqual([]);
});
