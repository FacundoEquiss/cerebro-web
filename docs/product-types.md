**English** · [Español](product-types.es.md)

# Product types

Cerebro Web is a base for **any line of business**. What makes that possible is one field of the
product, `type`, plus a way of selling by weight or measure. This page says what each type does,
what you configure, and what the server guarantees.

| `type` | What it is | The product page asks for | Shipping | After the payment |
|---|---|---|---|---|
| `physical` | A thing that is shipped or picked up (the default) | Options, quantity | Yes | The order is prepared |
| `digital` | A file | Nothing (one per order line) | No | A signed download link that expires |
| `service` | An appointment | Day and time (and seats) | No | The slot is already reserved |
| `quote` | Something without a public price | Quantity and a description | Set by the owner | — it is paid after the quote is accepted |

Three rules hold for all of them, and they are the same in `lib/orders/pricing.ts` (the `json`
adapter) and in `create_order()` (`db/schema.sql`, the database adapters):

1. **The server sets the price.** The browser sends ids, quantities and, for a service, the slot.
   Never an amount.
2. **Shipping only if something is shipped.** An order without a physical product has the method
   `none`, asks for no address and costs no shipping — whatever the browser sent.
3. **A cart can mix types.** One download, one appointment and one mug are one order.

## Where a product gets its type

- In the admin panel: **Products → a product → Type and how it is sold**.
- In the catalogue file (`content/products.json`, the `json` adapter) or in the `products` table:

```jsonc
{
  "id": "mixed-nuts", "type": "physical",
  "price": 19500,          // per unit of measure
  "unit": "kg",            // "u" (a piece, the default), "kg", "g", "l", "m", "m²"…
  "step": 0.1,             // quantities are multiples of this
  "minQuantity": 0.1,      // the minimum of one line (the "min")
  "maxQuantity": 3,        // optional; null = commerce.maxQuantityPerLine
  "stock": 25              // in the same unit; null = made to order
}
```

## Sale by unit, weight or measure

Works for any physical product (and for quotes: "per m²").

- `unit` is what the price refers to. With anything but `u` the store shows **"$ 19,500 / kg"**
  and the quantity with its unit ("0.7 kg").
- `step` and `minQuantity` define the valid quantities: with `step: 0.25` and `minQuantity: 0.25`
  the customer can buy 0.25, 0.5, 0.75… The **server** rejects anything else (`quantity` error):
  the stepper of the page is only a help.
- **Totals**: each line is rounded to cents on its own (`unit price × quantity`), and the subtotal
  adds the rounded lines. That is what the customer sees line by line, and both the TypeScript and
  the SQL do it the same way.
- **Stock** is in the same unit and may be a decimal (12.5 kg).
- Payment gateways count whole units: a line of 0.75 kg travels to the gateway as one item worth
  the line ("Coffee — 0.75 kg").
- **What is not built**: charging the difference when the real weight differs from the order.
  Write your policy (the product page has a line for it, `types.weightNote` in `i18n/`) and settle
  the difference by hand.

## Digital products

- The product has `digital: { "name": "guide.pdf", "file": "<storage key>" }`. Upload the file
  from the admin panel (**File that is delivered**); it goes to the **private** side of the storage
  adapter.
- **The file is never public.** It is not under `public/`; the storefront never receives the
  storage key (in SQL it lives in `product_files`, a table the public key cannot read at all).
- **Delivery**: when the order is paid — by a gateway webhook, or when the admin marks a `manual`
  order as paid — the order page shows a **Download** button and the "payment confirmed" e-mail
  carries the link.
- **The link** is `/api/downloads/<order>/<line>?e=<expiry>&s=<signature>`: signed by the server
  (`lib/orders/download.ts`), valid for `commerce.digital.linkHours` (72 by default). The route
  checks, in this order: the signature and the expiry → that the stored order **is paid right now**
  and not cancelled → that the line is a digital product with a file. The order page makes a
  fresh link every time it is opened, while the order link itself is valid (30 days).
- Storage: `local` keeps the files in `DATA_DIR/private`; `supabase` uses a **private** bucket
  (`SUPABASE_PRIVATE_BUCKET`, `downloads` by default — create it as private). Uploads are limited
  to 50 MB and to common document, archive, audio, video and image types (`DIGITAL_TYPES`); on
  serverless hosting the platform's request limit is lower.
- It needs an adapter that **stores orders** (a database, or `json` on a machine with a disk):
  without one nothing can tell whether an order was paid, so nothing is delivered.
- The example files of the presets are tiny PDFs in `content/downloads/` (`npm run samples`).

## Services by appointment

A service has `service: { "durationMinutes": 30, "capacity": 1 }`.

- **Opening hours** come from `config/commerce.ts` → `booking`: `timeZone` (IANA), `weekly`
  (ranges per weekday), `blockedDates` (closed days), `minNoticeHours`, `maxDaysAhead`. A product
  may override them: `service.weekly` replaces the week, `service.blockedDates` adds closed days.
- **Slots** start every `durationMinutes` inside each range and never run past closing time.
  `capacity` is how many seats fit in one slot (1 for a haircut, 8 for a class); the quantity of
  the order line is the number of seats.
- **Time zone**: hours are written as wall time of `booking.timeZone`; a slot is stored as the
  exact instant it starts and ends. A visitor elsewhere, a server in another zone and daylight
  saving changes cannot move an appointment.
- **Reservation**: the slot is reserved when the order is **created**. The server first checks
  that the slot is one the service really offers now (`lib/booking/slots.ts`), then
  `create_order()` checks the capacity with the product row locked — two simultaneous orders
  cannot take the last seat — and the same idempotency key always returns the same order.
- **Release**: a booking is a service line of an order that is not cancelled. Cancelling the
  order, or letting it expire unpaid (`ORDER_EXPIRY_HOURS`), frees the seat by itself. Mind that
  an unpaid order holds its slot until it expires: lower `ORDER_EXPIRY_HOURS` if that is too long
  for your business.
- **Agenda**: `/admin/agenda`, by day or by week (see [`admin.md`](admin.md)). The slot is also on
  the kanban card and in the order detail.
- **What is not built**: reminders, rescheduling by the customer, one calendar per member of
  staff, calendar sync, deposits. See [`ROADMAP.md`](../ROADMAP.md).

## Quotes

A `quote` product has no public price: the store shows **"Ask for the price"** and a form.

1. The customer sends a quantity and a description (`POST /api/quotes`). It becomes an order in
   the status `quote` — an **enquiry** — in the first column of the kanban. No amount anywhere.
2. The owner opens it, types a **unit price per line** and the **shipping**, and **sends** it. The
   customer gets an e-mail with a signed link.
3. The customer sees the quote on the order page and **accepts** it, choosing how to pay. From
   there it is a normal order (`new`): transfer, message or gateway.

What the server guarantees (`accept_quote()` in SQL, `acceptQuote` in the adapters):

- A quote that was **not sent** cannot be accepted or paid.
- It is accepted only for the **exact total that was sent**: the form posts the total the customer
  saw, and if the stored one differs — the price was changed, or the form was tampered with —
  nothing happens. Saving a new price *un-sends* the quote: it has to be sent again.
- A product without a price can never be added to a cart or to an order (`quote_only`).
- An enquiry never expires as "unpaid"; an accepted quote counts its `ORDER_EXPIRY_HOURS` from the
  moment it was accepted.

## Feeds and structured data

**Product feeds** (`/feeds/google.xml`, `/feeds/meta.xml`) list **only physical products with a
price** (`feedable()` in `lib/feeds/index.ts`). Why, as checked on 2026-11-20:

- **Google Merchant Center** — its "Unsupported Shopping content" policy
  (<https://support.google.com/merchants/answer/6150006>) says services are not allowed ("Labor,
  time, effort, expertise, or actions, which do not result in ownership of a tangible product"),
  and that e-books and digital books are not allowed in Shopping ads. Other digital goods can be
  accepted; they are left out by default to stay on the safe side. A row also needs a real price,
  which a quote product does not have.
- **Meta catalogue** — Meta's Commerce Policies page could **not** be opened from the environment
  where this was written, so this is **not verified** against the official text. Secondary sources
  agree that downloadable digital content, subscriptions and services are not accepted as catalogue
  listings. Treat it as "probably excluded" and read the current policy before changing it.

Policies change. To list another type, read the current policy of that platform first, then edit
`feedable()` — one function, tested in `tests/product-types.test.ts`.

Products sold by weight carry `unit_pricing_measure` ("1 kg") in the feeds.

**Structured data** (`productJsonLd` in `lib/seo.ts`):

| Type | JSON-LD |
|---|---|
| `physical` | `Product` + `Offer` (one per variant). By weight: the offer adds a `UnitPriceSpecification` |
| `digital` | `Product` + `Offer`, always in stock, no item condition |
| `service` | `Service` with its `provider` and an `Offer` with the price of one slot |
| `quote` | `Product` **without `offers`**: no public price, so none is declared — never a made-up amount |

## Presets: a starting catalogue per line of business

```bash
npm run preset              # lists them
npm run preset servicios    # applies one
npm run preset moda -- --keep-theme   # …without touching the colours
```

| Preset | For | Types it shows |
|---|---|---|
| `mixto` | The demo: one of everything | all four, and sale by weight |
| `moda` | Fashion and apparel | physical with size and colour |
| `hogar` | Home and decor | physical, variants, made to order |
| `tecnologia` | Technology and electronics | physical with stock, a set-up service |
| `almacen` | Pantry, health food | by the kilo and by the gram, packaged goods |
| `gastronomia` | Food and delivery | dishes with sizes, by the kilo, catering on a quote |
| `servicios` | Services by appointment | services (one seat and group), a product, a quote |
| `digital` | Digital products | downloads, mentoring by appointment, a quote |
| `a-medida` | Made-to-measure work, events, B2B | quotes, a survey visit, a sample kit |

A preset is a JSON file in `content/presets/` with products, categories, the home texts (hero,
benefits, questions) and a suggested palette. Applying one writes `content/products.json`,
`content/site.json`, the eight colours of `theme` in `config/brand.ts` and `db/seed.sql`.
**Everything in a preset is an example** — names, prices, texts — and its images are placeholders
drawn by `npm run images`. Replace all of it with the real data of the business.

To add a preset: copy one, change it, run `npm run images` (new shapes go in
`scripts/generate-images.mjs`) and `npm test` (every preset is validated).

## Upgrading from 0.1.0

See the migration notes in [`CHANGELOG.md`](../CHANGELOG.md#020---2026-11-20).
