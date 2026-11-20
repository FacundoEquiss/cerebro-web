**English** · [Español](adapters.es.md)

# Adapters

Everything that touches the outside world sits behind a small interface. The store and the admin
panel **read and write only through these adapters** — no page or route imports a database
client or a gateway SDK. That is what lets you change provider with an environment variable, and
what lets an **external CRM replace the admin panel**: implement the data adapter against your
CRM and both the store and the panel keep working.

| Adapter | Chosen by | Interface | Implementations |
|---|---|---|---|
| Data | `DATA_SOURCE` | `DataAdapter` in `lib/data/types.ts` | `json`, `supabase`, `postgres` |
| Payments | `PAYMENT_PROVIDER` | `PaymentAdapter` in `lib/payments/types.ts` | `manual`, `mercadopago`, `stripe` |
| E-mail | `MAIL_PROVIDER` | `MailAdapter` in `lib/mail/index.ts` | `console`, `resend`, `smtp` |
| Storage | `STORAGE_PROVIDER` | `StorageAdapter` in `lib/storage/index.ts` | `local`, `supabase` |
| Antibot | `ANTIBOT_PROVIDER` | `AntibotAdapter` in `lib/antibot/index.ts` | `none`, `turnstile` |

## Data

```ts
interface DataAdapter {
  readonly id: string;
  readonly storesOrders: boolean;   // false → the signed receipt is the only copy of an order
  readonly writable: boolean;       // false → the admin panel is read-only

  // storefront
  listProducts(): Promise<Product[]>;            // active products only
  listCategories(): Promise<Category[]>;
  createOrder(request, shipping): Promise<Order>; // prices calculated HERE, idempotent; reserves slots
  createQuote(request): Promise<Order>;           // an enquiry about a `quote` product (status "quote")
  acceptQuote(id, expectedTotal, provider, method): Promise<Order>; // only a SENT quote, for that exact total
  listBookings(from, to): Promise<Booking[]>;     // reserved slots between two instants (cancelled orders excluded)
  getDigitalFile(productId): Promise<{ name; file } | null>; // the private file of a digital product — server only
  getOrder(id): Promise<Order | null>;            // public shape: no personal data
  recordPayment(payment): Promise<{ firstTime; amountMatches }>;

  // admin panel
  listAllProducts(): Promise<Product[]>;          // paused ones included
  saveProduct(input): Promise<Product>;
  setStock(productId, variantId, stock): Promise<void>;
  listOrders(): Promise<AdminOrder[]>;            // newest first, with customer and timeline
  getAdminOrder(id): Promise<AdminOrder | null>;
  setOrderStatus(id, from, to, actor, reason?): Promise<AdminOrder>;
  addOrderNote(id, text, actor): Promise<AdminOrder>;
  setQuote(id, { prices, shipping }, actor): Promise<AdminOrder>; // price an enquiry (it stops being "sent")
  sendQuote(id, actor): Promise<AdminOrder>;      // from now on the customer can accept it
  setOrderTracking(id, tracking, actor): Promise<AdminOrder>;
  claimPurchaseEvent(id): Promise<boolean>;       // true ONLY for the first caller
  expireOrders(hours, reason): Promise<number>;   // cancel unpaid orders, return their stock
}
```

**What every implementation must guarantee**

1. `createOrder` **ignores any price in the request** and looks every amount up itself.
2. `createOrder` is **idempotent**: the same `idempotencyKey` returns the same order and takes
   stock once.
3. `recordPayment` credits a payment **once**, and marks the order paid only if the amount and
   currency equal the official total.
4. `setOrderStatus` fails with `AdminError("conflict")` if the order is no longer in `from`, and
   writes the move to the timeline. Cancelling returns the stock. (Which moves are allowed is
   decided before, in `lib/orders/status.ts` — not by the adapter.)
5. `claimPurchaseEvent` returns `true` exactly once per order.
6. `getOrder` never returns personal data; `getAdminOrder` is only called behind a session.
7. Cancelling or expiring an order returns **only the stock that order really took**, once.
8. A payment for a **cancelled** order is recorded in its timeline and reported back
   (`orderStatus: "cancelled"`), never credited.

**Since 0.2.0** (product types — see [`product-types.md`](product-types.md)):

9. `createOrder` accepts a quantity only if it is at least the product's minimum, at most its
   maximum and a **multiple of its `step`** (quantities may be decimals), rounds each line to
   cents on its own, and refuses a `quote` product (`quote_only`).
10. `createOrder` charges **shipping only if a line is a physical product**; otherwise the method
    is `none` and the shipping 0, whatever was sent.
11. A `service` line needs a slot. The slot is checked against the opening hours by the server
    (`lib/booking/slots.ts`) and its **capacity is checked atomically** when the order is created:
    simultaneous orders cannot oversell it. A cancelled or expired order holds no seat.
12. `listProducts` never returns the storage key of a digital file; only `getDigitalFile` and
    `listAllProducts` (behind a session) do.
13. `acceptQuote` throws `quote_not_sent` unless the quote was sent, and `quote_changed` unless
    `expectedTotal` equals the stored total. `setQuote` clears the "sent" mark. Accepting twice
    is the same as accepting once.
14. `expireOrders` never touches an enquiry, and counts an accepted quote from its acceptance.

A SQL-backed adapter gets all of this from `db/schema.sql` (`create_order`, `create_quote`,
`set_quote`, `send_quote`, `accept_quote`, `bookings_between`, `digital_file`). An adapter written
from scratch can reuse the pure functions: `priceOrder`, `buildQuote`, `quoteTotals`
(`lib/orders/pricing.ts`) and `resolveSlot` (`lib/booking/slots.ts`).

### `json` (default)

The catalogue is `content/products.json`.

- **Local** (`next dev`, or `next start` without `APP_ENV=production`): it stores for real, in
  files under `DATA_DIR` (`.data/` by default): `orders.json`, `catalog.json`, `uploads/`. The
  first run seeds example orders in every status (`DEMO_ORDERS=false` to start empty).
  `npm run data:export` copies the edited catalogue back to `content/products.json`.
- **Production**: read-only. Orders are not stored — each one travels to the buyer as a signed
  receipt and reaches the owner by WhatsApp / e-mail — and the panel shows example orders with
  the notice "demo mode: changes are not saved; connect a database".

### `supabase` and `postgres`

Both use the same schema, [`db/schema.sql`](../db/schema.sql) (run it once; it is safe to run
again), and the same code (`lib/data/sql.ts`). They only differ in transport: `supabase` calls
the project's REST API with `fetch` (public key for the read views, service key — server only —
for the functions); `postgres` uses the `pg` driver against `DATABASE_URL`.

Needs PostgreSQL 15 or newer. The schema: tables with **row level security on**; read-only
policies on the three catalogue tables; two public read views (`public_catalog`,
`public_categories`) that are `security_invoker`, so they can never be used to write; a
permissions block that first **revokes everything** from the public roles (Supabase creates
objects with all rights for them) and then grants only `select` on the catalogue; and functions
for every write — `create_order`,
`record_payment`, `set_order_status`, `add_order_note`, `set_order_tracking`,
`claim_purchase_event`, `save_product`, `set_stock`, `expire_orders` — plus `admin_orders` / `admin_catalog` for
the panel. The functions are executable only by the owner and the service role.

The tests run this real SQL on an in-process PostgreSQL (`tests/sql.test.ts`).

### Adding a data adapter (another database, a headless CMS, your CRM)

1. Create `lib/data/<name>.ts` exporting a `DataAdapter`. For an SQL database, implement only a
   `SqlGateway` and call `sqlAdapter("<name>", gateway)`.
2. Register it in `load()` in `lib/data/index.ts` and add the name to `DATA_SOURCE` in `lib/env.ts`.
3. Add its variables to `lib/env.ts` (validated) and `.env.example` (explained).
4. Test the guarantees above. `tests/admin-orders.test.ts` and `tests/sql.test.ts` are the models.

## Payments

```ts
interface PaymentAdapter {
  readonly id: string;
  methods(): PaymentMethod[];                    // what the checkout offers
  start(ctx): Promise<{ type: "instructions" } | { type: "redirect"; url }>;
  parseWebhook(req): Promise<{ type: "invalid" } | { type: "ignored" } | { type: "payment"; … }>;
  lookup?(orderId, params): Promise<PaymentRecord | null>;
}
```

- `manual` — no gateway: bank transfer or arranging by WhatsApp. The owner confirms the payment
  in the admin panel («Confirm payment»).
- `mercadopago` — Checkout Pro (hosted page) + a webhook that verifies `x-signature`.
- `stripe` — Checkout Session (hosted page) + a webhook that verifies `Stripe-Signature`.

The webhook lives at `/api/payments/<provider>/webhook` and always follows the same path
(`lib/payments/credit.ts`): **verify the signature → ask the gateway's API what really happened →
compare the amount with the official total → credit once**. The total travels to the gateway
sealed with an HMAC (`sealTotal`), so the comparison works even without a database.

To add a gateway: implement `PaymentAdapter`, register it in `lib/payments/index.ts`, add its
name and required secrets to `lib/env.ts`. The checkout and the webhook route need no change.
Always make one real payment end to end before going live.

## E-mail, storage, antibot

- **E-mail** (`send(mail): Promise<boolean>`, must never throw): `console` only logs; `resend`
  uses its HTTP API; `smtp` uses any SMTP server (`SMTP_URL`).
- **Storage** has two sides. Public — product photos — `put(name, bytes, contentType): Promise<url>`:
  `local` writes to `DATA_DIR/uploads` and serves it at `/media/<file>` (needs a persistent
  disk); `supabase` writes to a public Storage bucket. **Private** — the files of digital
  products — `putPrivate(name, bytes, contentType): Promise<key>` and
  `getPrivate(key): Promise<bytes | null>`: `local` keeps them in `DATA_DIR/private`, `supabase`
  in a private bucket (`SUPABASE_PRIVATE_BUCKET`). A private file has no URL: it leaves only
  through `/api/downloads/…`, for a paid order. S3-compatible storage is on the roadmap.
- **Antibot** (`verify(token, ip): Promise<boolean>`): `none`, or `turnstile`. The token is
  single-use: after every submit the form waits for a fresh one.
