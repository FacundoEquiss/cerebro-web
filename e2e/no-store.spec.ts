import { emailOf, expect, fillCheckout, test, watchConsole } from "./helpers";

// Two more servers run on the same build with a `json` adapter that stores NOTHING (what `json`
// is in production): one in demo mode — what the published demo is — and one as a real store.
// A slot, a quote and a download all need a stored order, so each mode has to be honest about it.
const PORT = Number(process.env.PORT ?? 3100);
const DEMO = `http://localhost:${PORT + 2}`;
const REAL = `http://localhost:${PORT + 3}`;
const customer = (name: string) => ({ name, email: emailOf(name), phone: "+00 000 000 1000" });
const key = (seed: string) => seed.repeat(64).slice(0, 64);

test("demo mode without a store: the flows can be tried, and the pages say nothing is really held", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Demo ${isMobile ? "Celular" : "Compu"}`;
  await page.goto(`${DEMO}/producto/corte-de-pelo`);
  // Honest, before anything is chosen.
  await expect(page.getByTestId("demo-not-stored")).toContainText("no queda tomado de verdad");
  await page.getByTestId("slot-date").selectOption({ index: 2 });
  const date = await page.getByTestId("slot-date").inputValue();
  // No seat is shown as taken: the example orders of the demo are not real bookings.
  const slots = (await (await page.request.get(`${DEMO}/api/slots?product=corte-de-pelo&date=${date}`)).json()) as { stored: boolean; slots: { left: number }[] };
  expect(slots.stored).toBe(false);
  expect(slots.slots.length).toBeGreaterThan(0);
  expect(slots.slots.every((s) => s.left === 1)).toBe(true);
  await expect(page.getByTestId("slot-picker").locator("fieldset label[data-off]")).toHaveCount(0);

  await page.getByTestId("slot-picker").locator("fieldset label").first().click();
  await page.getByTestId("add-to-cart").click();
  await page.getByTestId("view-cart").click();
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, name);
  await page.getByTestId("confirm-order").click();
  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByTestId("order-slot")).toBeVisible();
  // …and after: the order page does not pretend the slot is reserved.
  await expect(page.getByTestId("order-not-stored")).toContainText("no quedan reservados");

  // A quote: it can be sent to see how it works, and it says nobody will price it.
  await page.goto(`${DEMO}/producto/mueble-a-medida`);
  await expect(page.getByTestId("demo-not-stored")).toContainText("nadie va a recibirla ni cotizarla");
  await page.getByTestId("quote-name").fill(name);
  await page.getByTestId("quote-detail").fill("Una mesa de 1,60 por 0,80 m.");
  await page.getByTestId("quote-email").fill(emailOf(name));
  await page.getByTestId("quote-phone").fill("+00 000 000 1000");
  await page.getByTestId("quote-submit").click();
  await expect(page.getByTestId("order-page")).toBeVisible();
  await expect(page.getByTestId("order-not-stored")).toBeVisible();
  await expect(page.getByTestId("quote-accept-form")).toHaveCount(0);

  await page.goto(`${DEMO}/producto/guia-en-pdf`);
  await expect(page.getByTestId("demo-not-stored")).toContainText("la descarga no se entrega");
  expect(errors).toEqual([]);
});

test("a real store without a database: no booking, no quote form, no download — a way to get in touch, and the server refuses", async ({ page }) => {
  const errors = watchConsole(page);
  for (const slug of ["corte-de-pelo", "mueble-a-medida", "guia-en-pdf"]) {
    await page.goto(`${REAL}/producto/${slug}`);
    const contact = page.getByTestId("contact-instead");
    await expect(contact).toBeVisible();
    await expect(contact.getByTestId("contact-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
    await expect(contact.getByTestId("contact-link")).toHaveAttribute("href", "/contacto");
    for (const gone of ["slot-picker", "quote-form", "add-to-cart", "demo-not-stored"]) await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await expect(page.getByTestId("contact-instead")).toContainText("no está activa");

  // Whatever a browser sends, the server does not take what it cannot keep.
  const date = ((await (await page.request.get(`${REAL}/api/slots?product=corte-de-pelo`)).json()) as { dates: string[] }).dates[1]!;
  const time = ((await (await page.request.get(`${REAL}/api/slots?product=corte-de-pelo&date=${date}`)).json()) as { slots: { time: string }[] }).slots[0]!.time;
  const order = (lines: unknown[], seed: string) =>
    page.request.post(`${REAL}/api/orders`, { data: { idempotencyKey: key(seed), lines, customer: customer("Sin Base"), shippingMethodId: "pickup", paymentMethod: "bank_transfer" } });
  for (const [seed, lines] of [["1a", [{ productId: "corte-de-pelo", quantity: 1, slot: `${date}T${time}` }]], ["2b", [{ productId: "guia-en-pdf", quantity: 1 }]], ["3c", [{ productId: "vela-aromatica-de-soja", quantity: 1 }, { productId: "guia-en-pdf", quantity: 1 }]]] as const) {
    const refused = await order([...lines], seed);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "needs_store" });
  }
  const quote = await page.request.post(`${REAL}/api/quotes`, { data: { idempotencyKey: key("4d"), productId: "mueble-a-medida", quantity: 1, detail: "Una mesa a medida", customer: customer("Sin Base") } });
  expect(quote.status()).toBe(409);
  expect(await quote.json()).toMatchObject({ error: "needs_store" });
  // What it CAN do, it still does: a physical product, with the signed receipt as the only copy.
  expect((await order([{ productId: "vela-aromatica-de-soja", quantity: 1 }], "5e")).status()).toBe(200);

  // A physical product page is untouched.
  // (A category the admin tests do not add products to: the three servers share one page cache.)
  await page.goto(`${REAL}/producto/auriculares-inalambricos`);
  await expect(page.getByTestId("add-to-cart")).toBeVisible();
  await expect(page.getByTestId("contact-instead")).toHaveCount(0);
  expect(errors).toEqual([]);
});
