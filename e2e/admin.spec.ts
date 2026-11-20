import { E2E_ADMIN, expect, login, placeSimpleOrder, test, watchConsole } from "./helpers";

test("a new order shows up in «Nuevo» without reloading, moves to «Pagado», and the history records it", async ({ page, context, isMobile }) => {
  const errors = watchConsole(page);
  await login(page);
  const board = page.getByTestId("kanban");

  // A customer buys in another tab while the panel stays open.
  const shop = await context.newPage();
  const customer = `Cliente ${isMobile ? "Celular" : "Compu"} ${Date.now() % 100000}`;
  const orderId = await placeSimpleOrder(shop, customer);
  await shop.close();

  // No reload: the poll brings it (15 s at most), highlighted, and the tab title counts it.
  const card = board.locator(`[data-order="${orderId}"]`);
  await expect(page.getByTestId("column-new").locator(`[data-order="${orderId}"]`)).toBeVisible({ timeout: 25_000 });
  await expect(card).toHaveAttribute("data-fresh", "true");
  await expect(card).toContainText(customer);
  await expect(page).toHaveTitle(/^\(1\) /);

  if (isMobile) {
    // On a phone: the "Move to…" menu. No touch dragging.
    await card.getByTestId("move-select").selectOption("paid");
  } else {
    // On a computer: drag the card with the mouse.
    const from = (await card.boundingBox())!;
    const to = (await page.getByTestId("column-paid").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 30, from.y + 40, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 140, { steps: 12 });
    await expect(page.getByTestId("column-paid")).toHaveAttribute("data-over", "");
    await page.mouse.up();
  }
  await expect(page.getByTestId("column-paid").locator(`[data-order="${orderId}"]`)).toBeVisible();
  await expect(page.getByTestId("board-message")).toContainText(orderId);

  // The detail: status, payment and the timeline entry of the move.
  await page.getByTestId("column-paid").locator(`[data-order="${orderId}"]`).click({ position: { x: 30, y: 12 } });
  const detail = page.getByTestId("order-detail");
  await expect(detail.getByTestId("detail-status")).toHaveText("Pagado");
  await expect(detail.getByTestId("detail-payment-status")).toContainText("Pago confirmado");
  await expect(detail.getByTestId("detail-timeline")).toContainText("Nuevo → Pagado");
  await expect(detail.getByTestId("detail-timeline")).toContainText(E2E_ADMIN.email);

  // It survives a reload: it was saved, not just drawn.
  await page.reload();
  await expect(page.getByTestId("column-paid").locator(`[data-order="${orderId}"]`)).toBeVisible();

  // A move the rules forbid is refused by the server too.
  const forbidden = await page.request.post(`/api/admin/orders/${orderId}`, { data: { action: "move", to: "new" } });
  expect(forbidden.status()).toBe(422);

  expect(errors).toEqual([]);
});

test("the keyboard moves a card, and cancelling asks for a reason", async ({ page }) => {
  await login(page);
  const card = page.getByTestId("column-paid").getByTestId("order-card").first();
  const id = (await card.getAttribute("data-order"))!;
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("column-preparing").locator(`[data-order="${id}"]`)).toBeVisible();

  const moved = page.locator(`[data-order="${id}"]`);
  await moved.getByTestId("move-select").selectOption("cancelled");
  const detail = page.getByTestId("order-detail");
  await detail.getByTestId("cancel-confirm").click();
  await expect(detail.locator(".field-error")).toBeVisible(); // a reason is required
  await detail.getByTestId("cancel-reason").fill("El cliente se arrepintió");
  await detail.getByTestId("cancel-confirm").click();
  await expect(detail.getByTestId("detail-status")).toHaveText("Cancelado");
  await detail.getByTestId("detail-close").click();
  await page.getByTestId("cancelled-fold").locator("summary").click();
  await expect(page.getByTestId("cancelled-fold").locator(`[data-order="${id}"]`)).toBeVisible();
});

test("a product created in the panel is on sale in the store", async ({ page, isMobile }) => {
  const errors = watchConsole(page);
  const name = `Florero de prueba ${isMobile ? "celular" : "compu"}`;
  const slug = `florero-de-prueba-${isMobile ? "celular" : "compu"}`;
  await login(page);
  await page.goto("/admin/products");
  await page.getByTestId("new-product").click();
  await page.getByTestId("p-name").fill(name);
  await expect(page.getByTestId("p-slug")).toHaveValue(slug);
  await page.getByTestId("p-description").fill("Florero de cerámica esmaltada. Producto creado por la prueba automática.");
  await page.getByTestId("p-category").selectOption("hogar");
  await page.getByTestId("p-price").fill("23400");
  await page.getByTestId("p-stock").fill("6");

  // A photo: shrunk to WebP in the browser, and it cannot be saved without alternative text.
  await page.getByTestId("p-photo").setInputFiles({ name: "florero.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000"><rect width="2400" height="3000" fill="#d8d2c4"/><circle cx="1200" cy="1500" r="700" fill="#8a9a7b"/></svg>') });
  await expect(page.getByTestId("p-alt")).toBeVisible();
  await page.getByTestId("p-save").click();
  await expect(page.getByTestId("p-error")).toBeVisible();
  await page.getByTestId("p-alt").fill("Florero de cerámica verde sobre fondo claro");
  await page.getByTestId("p-save").click();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${slug}$`));

  // In the store: on the shelf, with its page, its price and its photo (WebP, 1600 px at most).
  await page.goto("/tienda/hogar");
  await page.getByTestId("product-card").filter({ hasText: name }).getByRole("link").click();
  await expect(page.getByTestId("product-name")).toHaveText(name);
  await expect(page.getByTestId("product-price")).toContainText("23.400");
  const image = page.getByTestId("product-image");
  await expect(image).toHaveAttribute("src", /^\/media\/florero-de-prueba-.*\.webp$/);
  const size = await image.evaluate((img: HTMLImageElement) => img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
  expect(Math.max(...size)).toBe(1600);

  // Inline stock edit in the list.
  await page.goto("/admin/products");
  await page.getByTestId("products-search").fill(name);
  const stock = page.getByTestId("product-row").getByTestId("stock-input");
  await expect(stock).toHaveValue("6");
  await stock.fill("2");
  await stock.blur();
  await expect(stock).toHaveAttribute("data-state", "saved");

  expect(errors).toEqual([]);
});

test("without a session, /admin redirects and its actions answer 401", async ({ page, request }) => {
  for (const path of ["/admin", "/admin/summary", "/admin/products", "/admin/products/new", "/admin/customers", "/admin/settings", "/admin/orders/P-DEMO0001/print"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
  const head = await request.get("/admin", { maxRedirects: 0 });
  expect(head.status()).toBe(307);
  expect(head.headers()["x-robots-tag"]).toContain("noindex");

  expect((await request.get("/api/admin/orders")).status()).toBe(401);
  const writes: [string, unknown][] = [
    ["/api/admin/orders/P-DEMO0001", { action: "move", to: "paid" }],
    ["/api/admin/products", { slug: "x", name: "x" }],
    ["/api/admin/products/stock", { productId: "taza-de-ceramica", variantId: null, stock: 1 }],
    ["/api/admin/upload", {}],
  ];
  for (const [path, data] of writes) expect((await request.post(path, { data })).status(), path).toBe(401);
  // A forged cookie is no session.
  const forged = await request.get("/api/admin/orders", { headers: { cookie: "admin_session=s1.eyJlbWFpbCI6ImEiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTk5OTl9.AAAA" } });
  expect(forged.status()).toBe(401);
});

test("the demo user sees everything and can change nothing; a wrong password is refused", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByTestId("demo-credentials")).toBeVisible();
  await page.getByTestId("login-email").fill(E2E_ADMIN.email);
  await page.getByTestId("login-password").fill("not-the-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();

  await page.getByTestId("demo-fill").click();
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("kanban")).toBeVisible();
  await expect(page.getByTestId("read-only-banner")).toBeVisible();
  const card = page.getByTestId("column-new").getByTestId("order-card").first();
  const id = (await card.getAttribute("data-order"))!;
  await card.getByTestId("move-select").selectOption("paid");
  await expect(page.getByTestId("board-message")).toContainText("Modo demo");
  await expect(page.getByTestId("column-new").locator(`[data-order="${id}"]`)).toBeVisible();
  // …and the server refuses it too, whatever the page does.
  expect((await page.request.post(`/api/admin/orders/${id}`, { data: { action: "move", to: "paid" } })).status()).toBe(403);

  await page.getByTestId("admin-logout").click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get("/api/admin/orders")).status()).toBe(401);
});
