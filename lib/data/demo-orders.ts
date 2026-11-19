// EXAMPLE ORDERS for the demo: a few orders in every status, built from the catalogue with dates
// relative to "now", so the published demo always shows a living kanban. Every person here is
// invented (example.com addresses, placeholder phones). Real stores never see this: a database
// adapter only shows real orders.

import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { tr } from "@/i18n";
import { selectionLabel, unitPrice } from "./availability";
import type { AdminOrder, OrderEvent, OrderLine, OrderStatus, PaymentMethod, Product } from "./types";

const PEOPLE = [
  ["Ana Ejemplo", "ana"], ["Bruno Muestra", "bruno"], ["Carla Demo", "carla"], ["Diego Prueba", "diego"],
  ["Elena Ejemplo", "elena"], ["Fabián Muestra", "fabian"], ["Gala Demo", "gala"], ["Hugo Prueba", "hugo"],
  ["Inés Ejemplo", "ines"], ["Joaquín Muestra", "joaquin"],
] as const;

const PATH: Record<OrderStatus, OrderStatus[]> = {
  new: [],
  paid: ["paid"],
  preparing: ["paid", "preparing"],
  shipped: ["paid", "preparing", "shipped"],
  delivered: ["paid", "preparing", "shipped", "delivered"],
  cancelled: ["cancelled"],
};

interface Spec {
  minutesAgo: number;
  status: OrderStatus;
  person: number;
  /** [product index, quantity] */
  items: [number, number][];
  pay: PaymentMethod;
  ship: "pickup" | "delivery";
  note?: { es: string; en: string };
}

const ATTRIBUTION: Record<string, string>[] = [
  { utm_source: "instagram", utm_medium: "social" },
  { utm_source: "google", utm_medium: "organic" },
  {},
];

const MIN = 1, HOUR = 60, DAY = 24 * 60;
const SPECS: Spec[] = [
  { minutesAgo: 6 * MIN, status: "new", person: 0, items: [[0, 2]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 48 * MIN, status: "new", person: 1, items: [[8, 2], [10, 1]], pay: "whatsapp", ship: "pickup" },
  { minutesAgo: 3 * HOUR, status: "new", person: 2, items: [[5, 1]], pay: "bank_transfer", ship: "delivery", note: { es: "Pidió que le avisemos antes de enviar.", en: "Asked us to message before shipping." } },
  { minutesAgo: 5 * HOUR, status: "paid", person: 3, items: [[1, 1], [2, 1]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 9 * HOUR, status: "paid", person: 4, items: [[12, 1]], pay: "whatsapp", ship: "pickup" },
  { minutesAgo: 1 * DAY + 2 * HOUR, status: "preparing", person: 5, items: [[0, 3], [3, 2]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 1 * DAY + 7 * HOUR, status: "preparing", person: 6, items: [[9, 2]], pay: "bank_transfer", ship: "delivery", note: { es: "Es para regalo: va con moño.", en: "It is a gift: add a ribbon." } },
  { minutesAgo: 2 * DAY + 3 * HOUR, status: "shipped", person: 7, items: [[6, 1], [7, 2]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 3 * DAY, status: "shipped", person: 8, items: [[4, 1]], pay: "whatsapp", ship: "pickup" },
  { minutesAgo: 4 * DAY + 5 * HOUR, status: "delivered", person: 9, items: [[5, 1], [2, 1]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 6 * DAY, status: "delivered", person: 0, items: [[8, 4]], pay: "bank_transfer", ship: "pickup" },
  { minutesAgo: 9 * DAY, status: "delivered", person: 3, items: [[1, 1]], pay: "whatsapp", ship: "delivery" },
  { minutesAgo: 13 * DAY, status: "delivered", person: 5, items: [[12, 1], [10, 2]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 18 * DAY, status: "delivered", person: 2, items: [[0, 1], [6, 1]], pay: "bank_transfer", ship: "delivery" },
  { minutesAgo: 24 * DAY, status: "delivered", person: 7, items: [[9, 1]], pay: "whatsapp", ship: "pickup" },
  { minutesAgo: 2 * DAY + 9 * HOUR, status: "cancelled", person: 4, items: [[3, 1]], pay: "bank_transfer", ship: "delivery" },
];

function line(product: Product, quantity: number): OrderLine {
  const variant = product.variants.find((v) => v.stock === null || v.stock > 0) ?? product.variants[0] ?? null;
  const selection = variant ? variant.options : Object.fromEntries(product.options.map((o) => [o.id, o.values[0]?.id ?? ""]));
  const image =
    product.images.find((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v)) ?? product.images[0];
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    name: product.name,
    variantLabel: selectionLabel(product, selection),
    quantity,
    unitPrice: unitPrice(product, variant),
    image: image?.src ?? null,
  };
}

export function demoOrders(products: Product[], now: number): AdminOrder[] {
  const active = products.filter((p) => p.active);
  if (active.length === 0) return [];
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const actor = "demo@example.com";

  return SPECS.map((spec, n) => {
    const lines = spec.items.map(([i, q]) => line(active[i % active.length]!, q));
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const method = commerce.shipping.methods.find((m) => m.id === spec.ship) ?? commerce.shipping.methods[0]!;
    const shipping = method.freeFrom !== null && subtotal >= method.freeFrom ? 0 : method.price;
    const [name, user] = PEOPLE[spec.person % PEOPLE.length]!;

    const steps = PATH[spec.status];
    const history: OrderEvent[] = [{ at: at(spec.minutesAgo), type: "created", from: null, to: "new", actor: "store", text: "" }];
    let from: OrderStatus = "new";
    steps.forEach((to, i) => {
      // Each step happened a bit later than the previous one, never in the future.
      const minutesAgo = Math.max(1, Math.round(spec.minutesAgo * (1 - (i + 1) / (steps.length + 1))));
      history.push({
        at: at(minutesAgo), type: "status", from, to, actor,
        text: to === "cancelled" ? tr({ es: "El cliente pidió cancelar.", en: "The customer asked to cancel." }) : "",
      });
      from = to;
    });
    if (spec.note) history.push({ at: at(Math.max(1, spec.minutesAgo - 2)), type: "note", from: null, to: null, actor, text: tr(spec.note) });
    const paid = history.find((e) => e.to === "paid");
    const tracking = spec.ship === "delivery" && (spec.status === "shipped" || spec.status === "delivered") ? `EX-${String(1000 + n)}` : null;

    return {
      id: `P-DEMO${String(n + 1).padStart(4, "0")}`,
      createdAt: at(spec.minutesAgo),
      currency: brand.currency,
      lines,
      subtotal,
      shipping: { methodId: method.id, price: shipping },
      total: subtotal + shipping,
      paymentProvider: "manual",
      paymentMethod: spec.pay,
      status: spec.status,
      paidAt: paid?.at ?? null,
      tracking,
      customer: {
        name,
        email: `${user}@example.com`,
        phone: `+00 000 000 ${String(1000 + spec.person)}`,
        ...(method.requiresAddress
          ? { address: tr({ es: `Calle de Ejemplo ${100 + n}`, en: `${100 + n} Example Street` }), city: tr({ es: "Ciudad de Ejemplo", en: "Example City" }), postalCode: "0000" }
          : {}),
      },
      attribution: ATTRIBUTION[n % ATTRIBUTION.length]!,
      history: history.sort((a, b) => a.at.localeCompare(b.at)),
      cancelReason: spec.status === "cancelled" ? tr({ es: "El cliente pidió cancelar.", en: "The customer asked to cancel." }) : null,
      purchaseSentAt: null,
    } satisfies AdminOrder;
  });
}
