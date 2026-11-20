// Shared by the two database adapters (supabase, postgres): both talk to the same schema
// (db/schema.sql) and only differ in HOW they reach it. Give this a `SqlGateway` and you
// get a full `DataAdapter` — that is all a new SQL-backed adapter has to implement.

import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { resolveSlot } from "@/lib/booking/slots";
import { AdminError, OrderError, type AdminOrder, type Booking, type Category, type DataAdapter, type DigitalFile, type Order, type Product, type ProductType } from "./types";

export interface SqlGateway {
  /** Rows of the view `public_catalog`. */
  catalog(): Promise<Record<string, unknown>[]>;
  /** Rows of the view `public_categories`, ordered by `position`. */
  categories(): Promise<Record<string, unknown>[]>;
  /** Calls a function of the schema with positional arguments and returns its jsonb result. */
  call(fn: SqlFunction, args: unknown[]): Promise<unknown>;
  /** Called after the catalogue changed, so cached reads are dropped. */
  invalidate?(): void;
}

export type SqlFunction =
  | "create_order" | "record_payment" | "get_order"
  | "admin_orders" | "admin_order" | "set_order_status" | "add_order_note" | "set_order_tracking"
  | "claim_purchase_event" | "admin_catalog" | "save_product" | "set_stock" | "expire_orders"
  | "create_quote" | "set_quote" | "send_quote" | "accept_quote" | "bookings_between" | "digital_file";

/** Positional argument names of every function (PostgREST wants them by name). */
export const SQL_ARGS: Record<SqlFunction, string[]> = {
  create_order: ["p"],
  get_order: ["p_id"],
  record_payment: ["p_provider", "p_payment_id", "p_order_id", "p_amount", "p_currency", "p_status"],
  admin_orders: ["p_limit"],
  admin_order: ["p_id"],
  set_order_status: ["p_id", "p_from", "p_to", "p_actor", "p_reason"],
  add_order_note: ["p_id", "p_text", "p_actor"],
  set_order_tracking: ["p_id", "p_tracking", "p_actor"],
  claim_purchase_event: ["p_id"],
  admin_catalog: [],
  save_product: ["p"],
  set_stock: ["p_product_id", "p_variant_id", "p_stock"],
  expire_orders: ["p_hours", "p_reason"],
  create_quote: ["p"],
  set_quote: ["p_id", "p", "p_actor"],
  send_quote: ["p_id", "p_actor"],
  accept_quote: ["p_id", "p_total", "p_provider", "p_method"],
  bookings_between: ["p_since", "p_until"],
  digital_file: ["p_product_id"],
};

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function rowToProduct(r: Record<string, unknown>): Product {
  const variants = (r.variants as Record<string, unknown>[] | null) ?? [];
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: String(r.description ?? ""),
    category: String(r.category),
    price: num(r.price),
    compareAtPrice: numOrNull(r.compare_at_price),
    images: (r.images as Product["images"]) ?? [],
    options: (r.options as Product["options"]) ?? [],
    variants: variants.map((v) => ({
      id: String(v.id),
      options: v.options as Record<string, string>,
      stock: numOrNull(v.stock),
      price: numOrNull(v.price),
    })),
    stock: numOrNull(r.stock),
    featured: Boolean(r.featured),
    active: r.active === undefined ? true : Boolean(r.active),
    minQuantity: num(r.min_quantity ?? 1),
    attributes: (r.attributes as Record<string, string>) ?? {},
    type: (r.type as ProductType | undefined) ?? "physical",
    unit: String(r.unit ?? "u"),
    step: num(r.step ?? 1),
    maxQuantity: numOrNull(r.max_quantity),
    service: (r.service as Product["service"]) ?? null,
    digital: (r.digital as Product["digital"]) ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

function toOrder(json: unknown): Order {
  const o = json as Order;
  return {
    ...o,
    subtotal: num(o.subtotal),
    total: num(o.total),
    shipping: { methodId: o.shipping.methodId, price: num(o.shipping.price) },
    lines: o.lines.map((l) => {
      const { note, ...line } = l;
      return { ...line, unitPrice: num(l.unitPrice), quantity: num(l.quantity), type: l.type ?? "physical", unit: l.unit ?? "u", slot: l.slot ?? null, ...(note ? { note } : {}) };
    }),
    paidAt: o.paidAt ?? null,
    tracking: o.tracking ?? null,
    quote: o.quote ?? null,
  };
}

function toAdminOrder(json: unknown): AdminOrder {
  const o = json as AdminOrder;
  return {
    ...toOrder(o),
    customer: o.customer,
    attribution: o.attribution ?? {},
    history: o.history ?? [],
    cancelReason: o.cancelReason ?? null,
    purchaseSentAt: o.purchaseSentAt ?? null,
  };
}

/** `ORDER_ERROR:<code>:<detail>` raised by create_order() → the typed error the UI translates. */
export function toOrderError(e: unknown): unknown {
  const m = /ORDER_ERROR:([a-z_]+):?(.*)/.exec(e instanceof Error ? e.message : String(e));
  return m ? new OrderError(m[1] as OrderError["code"], (m[2] ?? "").trim()) : e;
}

/** ORDER_NOT_FOUND / ORDER_CONFLICT / PRODUCT_ERROR raised by the admin functions → `AdminError`. */
export function toAdminError(e: unknown): unknown {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("ORDER_NOT_FOUND")) return new AdminError("not_found");
  if (message.includes("ORDER_CONFLICT")) return new AdminError("conflict");
  if (message.includes("QUOTE_INCOMPLETE")) return new AdminError("quote_incomplete");
  const m = /PRODUCT_ERROR:([a-z_]+)/.exec(message);
  if (m) return new AdminError(m[1] === "slug_taken" || m[1] === "category" ? m[1] : "invalid");
  return e;
}

/** `slot_start` / `slot_end` of a service line, once the server has checked the slot. */
function slotOf(line: { slot?: string | null }, product: Product | undefined, now: number): { slot_start?: string; slot_end?: string } {
  if (!line.slot || !product || product.type !== "service") return {};
  const slot = resolveSlot(product, line.slot, now);
  return { slot_start: slot.start, slot_end: slot.end };
}

export function sqlAdapter(id: string, gateway: SqlGateway): DataAdapter {
  return {
    id,
    storesOrders: true,
    writable: true,
    async listProducts() {
      return (await gateway.catalog()).map(rowToProduct);
    },
    async listCategories(): Promise<Category[]> {
      return (await gateway.categories()).map((c) => ({
        slug: String(c.slug),
        name: String(c.name),
        description: String(c.description ?? ""),
      }));
    },
    async createOrder(request, shipping) {
      // The slot of a service line is checked HERE against the opening hours (and turned into
      // exact instants); its capacity is checked inside create_order(), with the row locked.
      const byId = new Map(request.lines.some((l) => l.slot) ? (await gateway.catalog()).map(rowToProduct).map((p) => [p.id, p]) : []);
      const now = Date.now();
      // No prices travel in `lines`: create_order() looks them up in the database.
      const payload = {
        idempotency_key: request.idempotencyKey,
        currency: brand.currency,
        lines: request.lines.map((l) => ({
          product_id: l.productId,
          variant_id: l.variantId ?? null,
          selection: l.selection ?? {},
          quantity: l.quantity,
          ...slotOf(l, byId.get(l.productId), now),
        })),
        shipping: { method: request.shippingMethodId, price: shipping.price, free_from: shipping.freeFrom },
        payment_provider: request.paymentProvider,
        payment_method: request.paymentMethod,
        customer: request.customer,
        attribution: request.attribution ?? {},
        minimum_order: commerce.minimumOrder,
        max_quantity: commerce.maxQuantityPerLine,
      };
      try {
        return toOrder(await gateway.call("create_order", [payload]));
      } catch (e) {
        throw toOrderError(e);
      }
    },
    async createQuote(request) {
      const payload = {
        idempotency_key: request.idempotencyKey,
        currency: brand.currency,
        product_id: request.productId,
        quantity: request.quantity,
        detail: request.detail,
        customer: request.customer,
        attribution: request.attribution ?? {},
      };
      try {
        return toOrder(await gateway.call("create_quote", [payload]));
      } catch (e) {
        throw toOrderError(e);
      }
    },
    async acceptQuote(orderId, expectedTotal, paymentProvider, paymentMethod) {
      try {
        return toOrder(await gateway.call("accept_quote", [orderId, expectedTotal, paymentProvider, paymentMethod]));
      } catch (e) {
        throw toOrderError(e);
      }
    },
    async listBookings(from, to) {
      const rows = ((await gateway.call("bookings_between", [from, to])) as Booking[] | null) ?? [];
      return rows.map((b) => ({ ...b, seats: num(b.seats) }));
    },
    async getDigitalFile(productId) {
      const f = (await gateway.call("digital_file", [productId])) as Required<DigitalFile> | null;
      return f?.file ? f : null;
    },
    async getOrder(orderId) {
      const json = await gateway.call("get_order", [orderId]);
      return json ? toOrder(json) : null;
    },
    async recordPayment(p) {
      const r = (await gateway.call("record_payment", [p.provider, p.paymentId, p.orderId, p.amount, p.currency, p.status])) as {
        first_time: boolean;
        amount_matches: boolean | null;
        order_status?: Order["status"] | null;
      };
      return { firstTime: r.first_time, amountMatches: r.amount_matches, orderStatus: r.order_status ?? null };
    },

    async listAllProducts() {
      return ((await gateway.call("admin_catalog", [])) as Record<string, unknown>[]).map(rowToProduct);
    },
    async saveProduct(input) {
      try {
        const row = await gateway.call("save_product", [input]);
        gateway.invalidate?.();
        return rowToProduct(row as Record<string, unknown>);
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async setStock(productId, variantId, stock) {
      const found = await gateway.call("set_stock", [productId, variantId, stock]);
      gateway.invalidate?.();
      if (found !== true) throw new AdminError("not_found");
    },
    async listOrders() {
      return ((await gateway.call("admin_orders", [500])) as unknown[]).map(toAdminOrder);
    },
    async getAdminOrder(orderId) {
      const json = await gateway.call("admin_order", [orderId]);
      return json ? toAdminOrder(json) : null;
    },
    async setOrderStatus(orderId, from, to, actor, reason) {
      try {
        const json = await gateway.call("set_order_status", [orderId, from, to, actor, reason ?? ""]);
        if (to === "cancelled") gateway.invalidate?.(); // the stock went back
        return toAdminOrder(json);
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async addOrderNote(orderId, text, actor) {
      try {
        return toAdminOrder(await gateway.call("add_order_note", [orderId, text, actor]));
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async setQuote(orderId, answer, actor) {
      try {
        return toAdminOrder(await gateway.call("set_quote", [orderId, answer, actor]));
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async sendQuote(orderId, actor) {
      try {
        return toAdminOrder(await gateway.call("send_quote", [orderId, actor]));
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async setOrderTracking(orderId, tracking, actor) {
      try {
        return toAdminOrder(await gateway.call("set_order_tracking", [orderId, tracking, actor]));
      } catch (e) {
        throw toAdminError(e);
      }
    },
    async claimPurchaseEvent(orderId) {
      return (await gateway.call("claim_purchase_event", [orderId])) === true;
    },
    async expireOrders(hours, reason) {
      const count = Number(await gateway.call("expire_orders", [hours, reason]));
      if (count > 0) gateway.invalidate?.(); // the stock went back
      return count;
    },
  };
}
