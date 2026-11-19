import { expect, type Page } from "@playwright/test";
import admin from "./admin-user.json";

/** The local, throwaway admin the test server creates (scripts/e2e-server.mjs). */
export const E2E_ADMIN: { email: string; password: string } = admin;

/** Fails the test if the page logs a console error or throws. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${m.text()} (${page.url()})`);
  });
  page.on("pageerror", (e) => errors.push(`${e.message} (${page.url()})`));
  return errors;
}

export async function fillCheckout(page: Page, name = "Ana Ejemplo") {
  await page.getByTestId("checkout-form").waitFor();
  await page.getByTestId("checkout-name").fill(name);
  await page.getByTestId("checkout-email").fill("ana@example.com");
  await page.getByTestId("checkout-phone").fill("+00 000 000 1000");
}

/** Buys one unit of a product that has nothing to choose. Returns the order id. */
export async function placeSimpleOrder(page: Page, name = "Ana Ejemplo"): Promise<string> {
  await page.goto("/producto/cuaderno-a5-tapa-dura");
  await page.getByTestId("add-to-cart").click();
  await page.getByTestId("view-cart").click();
  await page.getByTestId("go-to-checkout").click();
  await fillCheckout(page, name);
  await page.getByTestId("confirm-order").click();
  await page.getByTestId("order-page").waitFor();
  return (await page.getByTestId("order-id").innerText()).trim();
}

export async function login(page: Page, user: { email: string; password: string } = E2E_ADMIN) {
  await page.goto("/admin/login");
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("kanban")).toBeVisible();
}
