// The shapes every data adapter speaks. See docs/adapters.md.

export interface Category {
  slug: string;
  name: string;
  description: string;
}

export interface ProductImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** If set, this image shows that value of an option (e.g. `{ color: "black" }`). */
  option?: Record<string, string>;
}

export interface OptionValue {
  id: string;
  label: string;
  /** CSS colour for colour swatches. */
  swatch?: string;
}

/** An axis the customer must choose: size, colour… */
export interface ProductOption {
  id: string;
  name: string;
  values: OptionValue[];
}

export interface Variant {
  id: string;
  /** One value id per option id: `{ size: "m", color: "black" }`. */
  options: Record<string, string>;
  /** Units available. `null` = made to order (always purchasable). */
  stock: number | null;
  /** Overrides the product price when set. */
  price?: number | null;
}

/**
 * What kind of thing is sold. It decides what the product page asks for, whether the order needs
 * shipping, and what happens after the payment. See docs/product-types.md.
 *   physical  a thing that is shipped or picked up (the default)
 *   digital   a file: no shipping; a signed, expiring download link once the order is paid
 *   service   an appointment: the customer picks a day and a time; the slot is reserved
 *   quote     no public price: the customer asks, the owner prices it, the customer accepts and pays
 */
export type ProductType = "physical" | "digital" | "service" | "quote";
export const PRODUCT_TYPES: readonly ProductType[] = ["physical", "digital", "service", "quote"];

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Opening ranges per weekday, in the store's time zone: `{ mon: [["09:00", "13:00"]] }`. */
export type WeeklyAvailability = Partial<Record<Weekday, [string, string][]>>;

/** Settings of a `service` product. What is missing falls back to `commerce.booking`. */
export interface ServiceSettings {
  /** Length of one appointment. Slots start every `durationMinutes` inside each opening range. */
  durationMinutes: number;
  /** People (or seats) that fit in ONE slot. */
  capacity: number;
  /** Overrides `commerce.booking.weekly` for this product. */
  weekly?: WeeklyAvailability | null;
  /** Extra closed days (`YYYY-MM-DD`), added to `commerce.booking.blockedDates`. */
  blockedDates?: string[];
}

/** The file of a `digital` product. PRIVATE: it is only served to paid orders (lib/orders/download.ts). */
export interface DigitalFile {
  /** The name the customer sees and downloads ("guide.pdf"). */
  name: string;
  /** Key of the file in the private storage. Only the admin panel and the server ever read it. */
  file?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  /** List price, shown crossed out when higher than `price`. */
  compareAtPrice: number | null;
  images: ProductImage[];
  /** Declared axes. If there is at least one, the customer MUST choose — with or without variants. */
  options: ProductOption[];
  /** Generated combinations. May be empty even when `options` is not: everything is made to order. */
  variants: Variant[];
  /** Stock of a product without options. `null` = made to order. */
  stock: number | null;
  featured: boolean;
  /** False = paused: hidden from the store, still visible in the admin panel. */
  active: boolean;
  /** Smallest quantity of one line, in `unit` (the "min"). May be a decimal: 0.25 kg. */
  minQuantity: number;
  type: ProductType;
  /**
   * Unit of measure the price refers to: "u" (a piece — the default), "kg", "g", "m", "l"…
   * With anything but "u" the price is shown as "$ X / kg" and quantities may be decimals.
   */
  unit: string;
  /** Quantities must be multiples of this (1 for pieces, 0.25 for a quarter kilo…). */
  step: number;
  /** Largest quantity of one line. `null` = `commerce.maxQuantityPerLine`. */
  maxQuantity: number | null;
  /** Only for `type: "service"`. */
  service: ServiceSettings | null;
  /** Only for `type: "digital"`. The storefront never receives `file`. */
  digital: DigitalFile | null;
  /** Extra attributes for the feeds (gender, ageGroup, material, googleCategory…). */
  attributes: Record<string, string>;
  createdAt: string;
}

export type Availability = "in_stock" | "made_to_order" | "out_of_stock";

// ---- orders ----

/** What the browser sends: ids and quantities. NEVER prices. */
export interface OrderLineRequest {
  productId: string;
  variantId?: string | null;
  selection?: Record<string, string>;
  /** Units, or kilos, metres… — a multiple of the product's `step`. For a service: seats. */
  quantity: number;
  /** Service only: the chosen slot as wall time of the store, `YYYY-MM-DDTHH:MM`. */
  slot?: string | null;
}

/** A reserved appointment: the instant it starts and ends (ISO, UTC). */
export interface Slot {
  start: string;
  end: string;
}

export interface Customer {
  name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  postalCode?: string;
  notes?: string;
}

export type PaymentMethod = "whatsapp" | "bank_transfer" | "online";

/**
 * Where an order is in the owner's workflow — the columns of the admin kanban.
 * `quote` = an enquiry about a product without a public price: not an order yet.
 * Allowed moves: lib/orders/status.ts.
 */
export type OrderStatus = "quote" | "new" | "paid" | "preparing" | "shipped" | "delivered" | "cancelled";

export interface OrderRequest {
  idempotencyKey: string;
  lines: OrderLineRequest[];
  customer: Customer;
  /** "none" when nothing in the order is shipped (the server decides, not the browser). */
  shippingMethodId: string;
  paymentProvider: string;
  paymentMethod: PaymentMethod;
  attribution?: Record<string, string>;
}

/** An enquiry about ONE `quote` product. It becomes an order in the status `quote`. */
export interface QuoteRequest {
  idempotencyKey: string;
  productId: string;
  quantity: number;
  /** What the customer needs, in their words. */
  detail: string;
  customer: Customer;
  attribution?: Record<string, string>;
}

/** Where a quote with shipping is delivered. Required to accept it when the shipping is not 0. */
export type Delivery = Pick<Customer, "address" | "city" | "postalCode">;

/** What the owner answers to an enquiry: a unit price per line (in order) and the shipping. */
export interface QuoteAnswer {
  prices: number[];
  shipping: number;
}

export interface OrderLine {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string;
  quantity: number;
  /** Per `unit`. 0 in an enquiry that was not priced yet. */
  unitPrice: number;
  image: string | null;
  type: ProductType;
  unit: string;
  /** The reserved appointment of a service line. */
  slot: Slot | null;
  /** What the customer asked for in an enquiry. */
  note?: string;
  /** Internal: this line took units from the stock (cancelling returns only those). */
  stockTaken?: boolean;
}

/** The OFFICIAL order: every amount in it was calculated on the server. No personal data. */
export interface Order {
  id: string;
  createdAt: string;
  currency: string;
  lines: OrderLine[];
  subtotal: number;
  shipping: { methodId: string; price: number };
  total: number;
  paymentProvider: string;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  /** When the money was confirmed. `null` = not paid yet. */
  paidAt: string | null;
  tracking: string | null;
  /**
   * Set when the order was born as an enquiry. `sentAt` = when the owner sent the price;
   * `null` = still being priced (it cannot be accepted or paid).
   */
  quote: { sentAt: string | null } | null;
}

/** One reserved slot, as the Agenda of the admin panel shows it. */
export interface Booking {
  orderId: string;
  productId: string;
  name: string;
  variantLabel: string;
  start: string;
  end: string;
  seats: number;
  orderStatus: OrderStatus;
  paid: boolean;
  customerName: string;
  customerPhone: string;
}

export interface OrderEvent {
  at: string;
  type: "created" | "status" | "payment" | "note" | "tracking" | "quote";
  from: OrderStatus | null;
  to: OrderStatus | null;
  /** Who did it: an admin e-mail, "store", or a payment provider id. */
  actor: string;
  /** The note, the cancellation reason, the tracking code or the payment id. */
  text: string;
}

/** The order as the admin panel sees it: with the customer and the full timeline. */
export interface AdminOrder extends Order {
  customer: Customer;
  attribution: Record<string, string>;
  history: OrderEvent[];
  cancelReason: string | null;
  /** When the `purchase` event was reported to the ad platforms (it is reported ONCE). */
  purchaseSentAt: string | null;
}

/** What the admin panel sends to create or edit a product. */
export type ProductInput = Omit<Product, "createdAt"> & { createdAt?: string };

export interface PaymentRecord {
  provider: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: "approved" | "pending" | "rejected";
}

export interface PaymentRecordResult {
  /** False when this payment id was already processed: do nothing again. */
  firstTime: boolean;
  /** False when amount or currency differ from the official total: do NOT mark as paid. */
  amountMatches: boolean | null;
  /**
   * The status of the order when the payment arrived, if the adapter stores orders.
   * "cancelled" = money came in for a cancelled order: it was NOT credited, a person must review it.
   */
  orderStatus?: OrderStatus | null;
}

/** Shipping conditions of the chosen method, read by the SERVER from config/commerce.ts. */
export interface ShippingTerms {
  price: number;
  freeFrom: number | null;
}

/** Why an order could not be created. `code` is stable: the UI translates it. */
export class OrderError extends Error {
  constructor(
    public code:
      | "empty" | "unknown_product" | "selection_required" | "unknown_variant" | "out_of_stock"
      | "quantity" | "minimum_order" | "shipping_method" | "address_required"
      | "slot_required" | "slot_invalid" | "slot_taken" | "quote_only" | "not_a_quote"
      | "quote_not_sent" | "quote_changed" | "quote_incomplete" | "not_found"
      | "booking_limit" | "needs_store",
    public detail = "",
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

/** The admin panel tried to write through an adapter that cannot store anything. */
export class ReadOnlyError extends Error {
  constructor() {
    super("READ_ONLY");
  }
}

/** Someone else changed the order first (or it does not exist). `code` is stable. */
export class AdminError extends Error {
  constructor(public code: "not_found" | "conflict" | "invalid_transition" | "slug_taken" | "category" | "invalid" | "quote_incomplete", detail = "") {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * A DATA ADAPTER: where the catalogue lives and where orders go. The storefront AND the admin
 * panel read and write only through this interface, so an external CRM can replace the panel.
 * Implementations: `json` (demo / local file), `supabase`, `postgres`. See docs/adapters.md.
 */
export interface DataAdapter {
  readonly id: string;
  /** False when orders are not stored (the signed receipt is the only copy). */
  readonly storesOrders: boolean;
  /** False when the admin panel cannot save anything (json in production): it is read-only. */
  readonly writable: boolean;

  // ---- storefront ----
  /** Active products only. */
  listProducts(): Promise<Product[]>;
  listCategories(): Promise<Category[]>;
  /**
   * Creates the order with prices calculated by the adapter (never taken from the request).
   * Must be idempotent: the same `idempotencyKey` returns the same order. Throws `OrderError`.
   */
  createOrder(request: OrderRequest, shipping: ShippingTerms): Promise<Order>;
  /**
   * Registers an enquiry about a `quote` product: an order in the status `quote`, with no price.
   * Idempotent like `createOrder`. Throws `OrderError`.
   */
  createQuote(request: QuoteRequest): Promise<Order>;
  /**
   * The customer accepts a SENT quote: it becomes a normal order (`new`). `expectedTotal` is the
   * total the customer saw: if the stored one differs, or the quote was not sent, it throws
   * `OrderError` ("quote_changed" / "quote_not_sent") and nothing changes. A quote that charges
   * shipping needs `delivery` ("address_required").
   */
  acceptQuote(id: string, expectedTotal: number, paymentProvider: string, paymentMethod: PaymentMethod, delivery?: Delivery): Promise<Order>;
  /**
   * The appointments that overlap `[from, to)`. Cancelled orders do not count, and neither do
   * unpaid orders whose hold has lapsed (lib/booking/hold.ts) — checked when READING.
   */
  listBookings(from: string, to: string): Promise<Booking[]>;
  /** The private file of a digital product (with its storage key). Server only. */
  getDigitalFile(productId: string): Promise<Required<DigitalFile> | null>;
  /** The stored order, or `null` if unknown or the adapter does not store orders. */
  getOrder(id: string): Promise<Order | null>;
  /** Registers a payment exactly once and marks the order as paid when the amount matches. */
  recordPayment(payment: PaymentRecord): Promise<PaymentRecordResult>;

  // ---- admin panel ----
  /** Every product, paused ones included. */
  listAllProducts(): Promise<Product[]>;
  /** Creates or updates a product (same `id` = update). Throws `AdminError`. */
  saveProduct(input: ProductInput): Promise<Product>;
  /** `variantId` null = the product's own stock. `stock` null = made to order. */
  setStock(productId: string, variantId: string | null, stock: number | null): Promise<void>;
  /** Newest first (the latest 500). */
  listOrders(): Promise<AdminOrder[]>;
  getAdminOrder(id: string): Promise<AdminOrder | null>;
  /**
   * Moves an order `from` → `to` and writes it to the timeline. Throws `AdminError("conflict")`
   * if the order is no longer in `from`. Cancelling returns the stock. The RULES of which moves
   * are allowed are not the adapter's job: lib/admin/orders.ts checks them first.
   */
  setOrderStatus(id: string, from: OrderStatus, to: OrderStatus, actor: string, reason?: string): Promise<AdminOrder>;
  addOrderNote(id: string, text: string, actor: string): Promise<AdminOrder>;
  /** Saves the prices of an enquiry. It is NOT sent yet (and a sent quote stops being sent). */
  setQuote(id: string, answer: QuoteAnswer, actor: string): Promise<AdminOrder>;
  /** Marks the quote as sent: from now on the customer can accept it. Throws if a line has no price. */
  sendQuote(id: string, actor: string): Promise<AdminOrder>;
  setOrderTracking(id: string, tracking: string, actor: string): Promise<AdminOrder>;
  /** True ONLY for the first caller: whoever gets it reports the purchase. */
  claimPurchaseEvent(id: string): Promise<boolean>;
  /**
   * Cancels the orders still unpaid in `new` after `hours`, with `reason`, and returns their
   * stock. Returns how many were cancelled. Unpaid orders must not hold stock forever. Orders
   * with an appointment whose hold lapsed are cancelled too, whatever `hours` is (even 0).
   */
  expireOrders(hours: number, reason: string): Promise<number>;
}
