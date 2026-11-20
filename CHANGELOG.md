# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-20

**From a template that works to a store someone can start alone.**

### Added

- **The tests have their own store** (`tests/fixtures/`: catalogue, home texts, brand and
  commercial rules). `npm test` and `npm run test:e2e` no longer read `content/` or `config/`, so
  they stay green after `npm run preset <name>` and with any catalogue made by hand. The
  end-to-end build switches to the fixtures with `CEREBRO_FIXTURES=1` (`tsconfig.fixtures.json`).
- **`npm run check:catalog`** (part of `npm run check`): validates YOUR catalogue — slugs,
  categories, types, images, variants, quantity rules, dates — and lists drafts and texts still
  marked EXAMPLE. A CI job applies every preset and runs the checks and the unit tests.
- **`docs/go-live.md`** (es/en): from zero to selling for an owner who does not program, written
  for an agent to lead them — database, schema, private bucket, variables, admin user, payments,
  e-mail, domain, demo off — with links to each provider's official documentation.
  **`npm run doctor`** says what is ready and the single next step.
- **`packages/create-cerebro-web`**: `npm create cerebro-web@latest my-store` (clone or tarball,
  preset, install, fresh git, next steps; `--preset`, `--no-install`, `--no-git`, `--yes`). **Not
  published to npm yet** — `PUBLISHING.md` has the steps for the owner; until then, `git clone`.
- **Events with fixed dates**: a service with `service.sessions` is sold by sign-up to those
  dates, each with its places — a list of dates with "N places left" and "Sign up" instead of the
  weekly calendar — on the same booking engine (holds, limits, overlap, Agenda). `Event`
  structured data; "Fixed dates" in the product editor; examples in three presets.
- **Drafts**: a product without a price (`"price": null`, or "Draft" in the panel) is hidden from
  the store, the search, the sitemap, the feeds, `llms.txt` and the structured data, and cannot be
  ordered. The panel shows "Price missing"; `check:catalog` and `doctor` list them.
- The published brain links to the code and the demo (`enlaces` in `cerebro/datos.json`), and has
  new nodes: events, drafts, and "from zero to selling" (334 nodes).

### Changed

- **Example orders load only in demo mode.** A real store (`DEMO_MODE=false`) starts with an empty
  panel — they used to hold seats of real appointments. `DEMO_ORDERS=true|false` overrides it.
- The words of a booking are neutral where a line may be an appointment or an event ("Date and
  time", "Your booking").
- The admin product page offers "view in store" only for products that are on sale.

### Migrating from 0.2.0

1. **Database**: run `db/migrations/0003_drafts.sql` and then `db/schema.sql` again (or only
   `db/schema.sql`). It adds `products.draft` and hides drafts from the public key. Back up and
   ask the owner first. Nothing is deleted; no existing product becomes a draft.
2. **Your own data adapter**: `Product` has a new field, `draft`; `listProducts` must leave drafts
   out and `createOrder` must refuse them.
3. **Tests you wrote against the demo catalogue** now run against `tests/fixtures/products.json`
   (the same products as the 0.2.0 demo). Tests that read `content/products.json` on purpose keep
   doing so.
4. **Demo orders**: if you relied on the example orders outside demo mode, set `DEMO_ORDERS=true`.
5. Nothing else changes for a store without events or drafts.


## [0.2.0] - 2026-11-20

**A base for any line of business, not only for clothes.** Products now have a type, can be sold
by weight or measure, and a cart can mix them. See [`docs/product-types.md`](docs/product-types.md).

### Added

- **Product types** (`Product.type`): `physical` (as before), `digital`, `service` and `quote`.
  - **Digital**: no shipping. The file is private (private side of the storage adapters, never
    under `public/`); once the order is paid — by a gateway, or when the admin marks a manual
    order as paid — the order page and the e-mail carry a signed download link that expires
    (`/api/downloads/…` checks that the order is paid before serving the file).
  - **Service**: duration, seats per slot, weekly opening hours with per-product overrides,
    closed days and a configurable time zone (`commerce.booking`). The customer picks a day and a
    time on the product page. The slot is reserved when the order is created — validated on the
    server, atomically (no overselling with simultaneous orders), idempotently — and freed when
    the order is cancelled or expires. New **Agenda** in the admin panel (day and week).
  - **Quote**: no public price. "Ask for a quote" form → an **enquiry** in a new first column of
    the kanban → the admin types a price per line and the shipping and sends it → the customer
    accepts and pays from a signed link, and it becomes a normal order. It cannot be accepted
    before it is sent, nor for a total other than the one that was sent.
- **Sale by unit, weight or measure**: `unit` (u, kg, g, m, l…), `step`, minimum (`minQuantity`)
  and `maxQuantity`. Prices are shown "per kg"; quantities and stock may be decimals; the server
  validates the multiples and rounds each line and the total.
- **Mixed carts**: shipping is asked and charged only when the order has a physical product.
- **Presets** (`content/presets/`, `npm run preset`): starting catalogues for nine lines of
  business with products, categories, home texts and a suggested palette. The demo is now the
  mixed preset, and in demo mode the home page says what the project is.
- Home texts in `content/site.json`; example downloads in `content/downloads/` (`npm run samples`).
- Data adapter methods: `createQuote`, `acceptQuote`, `setQuote`, `sendQuote`, `listBookings`,
  `getDigitalFile`. Storage adapter methods: `putPrivate`, `openPrivate`.
- Routes: `POST /api/quotes`, `POST /api/quotes/accept`, `GET /api/slots`,
  `GET /api/downloads/[id]/[line]`, `POST /api/admin/upload-file`, `/admin/agenda`.
- `db/migrations/`: `0001_initial.sql` (the 0.1.0 schema) and `0002_product_types.sql`
  (self-contained for the data: it recreates the public catalogue view it has to drop).
- **A store that cannot keep orders is honest about it** (`lib/store-mode.ts`): services, quotes
  and digital products need an adapter that stores orders. On `json` in production a real store
  shows a "message us" button for them and the server answers `needs_store`; in demo mode the
  flows can be tried and the pages say nothing is reserved, priced or delivered.
- **Appointments**: capacity counts overlapping bookings (a change of duration cannot
  double-book); an unpaid order holds its slot for `booking.holdHours` / `BOOKING_HOLD_HOURS`
  (12 h) and a lapsed hold stops counting at once, with nothing to run; at most
  `booking.maxSlotsPerOrder` appointments per order and `booking.maxUnpaidPerBuyer` unpaid ones
  per buyer; times the clocks skip on a daylight-saving change are not offered.
- **Quotes**: the panel says whether the e-mail really went out and shows the customer's signed
  link with "copy" and "send by WhatsApp"; a quote that charges shipping asks for the delivery
  address before it can be accepted.
- **Money** is computed in integers and rounded half up (`lib/decimal.ts`), so TypeScript and
  PostgreSQL give the same cent; tested over a grid of prices and quantities.
- **`npm run preset` is safe**: it refuses (unless `--force`) over a catalogue, home texts or
  colours that are not a preset's, or over uncommitted changes; it always keeps a timestamped copy
  in `.preset-backups/` and sets aside the local `catalog.json` and `orders.json`.
- Downloads are streamed; a public Supabase bucket is refused for private files; the example
  downloads travel with the serverless bundle and the Docker image.
- The signed order link stays under 12 000 characters even for 50 lines with slots (big orders
  are slimmed: no photos, short names), and never carries the free text of an enquiry.
- The brain: a new branch, «Adaptar a tu rubro» (331 nodes).

### Changed

- **Feeds** (Google, Meta) list only physical products with a price; products by weight carry
  `unit_pricing_measure`.
- **Structured data** per type: `Service` for services; no `offers` for products without a price.
- Order workflow: a new first status, `quote`; an order **with nothing to ship** (services,
  downloads) may go from «Paid» straight to «Delivered» — the server refuses it for the rest.
- A digital product is one per order line (quantity 1).
- The "payment confirmed" e-mail is now also sent when the admin marks an order as paid by hand
  (it is the e-mail that carries the download links) — once per order, the first time it is paid.
- The sales summary does not count enquiries as orders or as pending payments.
- The subtotal is the sum of the lines rounded one by one (it only differs from 0.1.0 with
  decimal quantities).
- The end-to-end tests run with the rate limits on, each test as its own visitor.

### Security

- The forbidden-word list of the brand check no longer lives in the repository in any form: it is
  a local, git-ignored `.brand-blocklist` file. Generic patterns are always checked.
- SQL: the public views are `security_invoker` and the schema revokes every right of the public
  roles before granting `select` on the catalogue — with permissive default grants the public key
  could update prices through a view. Tested against those default grants.
- No fixed key signs sessions or receipts any more: secrets are mandatory in production (the
  server refuses to start) and random per machine elsewhere. Demo sessions use a key that can
  only produce a read-only session.
- Rate limits read the caller's address from a trusted source (`TRUSTED_PROXY_HEADER`) and failed
  logins are also counted per e-mail.

### Also added (unreleased work since 0.1.0)

- Unpaid orders expire after `ORDER_EXPIRY_HOURS` and release their stock, lazily and through
  `/api/cron/expire-orders`.
- "Pay now" on the page of an unpaid online order; the checkout says when the gateway failed.
- The environment is validated when the server starts (`instrumentation.ts`).

### Fixed

- The same idempotency key with a different cart can no longer return the same order id with
  another total (json adapter); a gateway without a database is refused in production.
- Cancelling returns only the stock an order really took.
- A payment for a cancelled order is flagged for review instead of reported as credited.
- Absolute photo URLs are kept as they are in the feeds and the structured data.
- The README screenshots are tracked by git.

### Migrating from 0.1.0

Nothing is deleted and no setting changes meaning. Existing products become `physical`, sold by
the piece; existing orders keep working.

1. **Code**: update, `npm install`, then run the whole verification
   (`npm run check && npm run typecheck && npm test && npm run build && npm run test:e2e`).
2. **Database (`supabase` or `postgres`)** — back it up and ask the owner first. Run
   `db/migrations/0002_product_types.sql` and then `db/schema.sql` again (it replaces the views,
   the functions and the permissions). Running `db/schema.sql` alone gives the same result. Both
   are safe to run twice. What changes: `products` gets `type`, `unit`, `step`, `max_quantity`,
   `service`, `digital`; quantities and stock become `numeric(12,3)`; `orders` gets `is_quote`,
   `quote_sent_at`, `accepted_at`, `hold_until` and the status `quote`; `order_lines` gets `type`, `unit`,
   `slot_start`, `slot_end`, `note`; a new table `product_files`; `set_stock` takes a numeric.
3. **`json` adapter**: nothing to do. Catalogues and orders saved by 0.1.0 under `DATA_DIR` are
   read with the defaults.
4. **Your own data adapter**: implement the six new methods (TypeScript lists them). The
   guarantees are in [`docs/adapters.md`](docs/adapters.md), items 9 to 17.
5. **Your own storage adapter**: implement `putPrivate` and `openPrivate` (a stream).
6. **Code that builds a `Product`, an `OrderLine` or an `Order`** needs the new fields: `type`,
   `unit`, `step`, `maxQuantity`, `service`, `digital` (product); `type`, `unit`, `slot` (line);
   `quote` (order). `ShippingTerms` are now optional in `priceOrder`, and `PricedOrder` returns
   `shippingMethodId`.
7. **Supabase with digital products**: create a **private** bucket (`downloads`, or the name in
   `SUPABASE_PRIVATE_BUCKET`). The server refuses to use it if it is public.
   **Services, quotes and digital products need `supabase` or `postgres`** (or `json` on your
   own machine): `json` in production stores no orders.
8. **The demo catalogue changed.** If your store still used `content/products.json` as it came,
   it is now the mixed preset; `npm run preset moda` brings back a clothing catalogue. A catalogue
   you already edited is yours and is not touched.
9. **Services**: set `booking` in `config/commerce.ts` (time zone and opening hours) before
   publishing a service; the values that ship are examples.

## [0.1.0] - 2026-11-19

First public release.

### Added

- **Storefront**: home, shop with filters behind one button and sort, categories, product page
  (gallery, mandatory option choice with or without generated variants, stock, `Product` and
  `BreadcrumbList` structured data), cart, checkout, signed order page that needs no cookie,
  search, contact, legal templates, 404, loading and error states. Mobile first, server-rendered.
- **Admin panel** (`/admin`): sign-in with scrypt hashes and a signed session cookie, login rate
  limit, read-only demo user; orders kanban with mouse drag, a "Move to…" menu for touch and
  keyboard shortcuts; live reception by polling with tab counter, sound and browser
  notifications; order detail with timeline, notes, tracking, cancel with reason, printable
  packing slip and label, WhatsApp message per status; sales summary with a chart; products with
  photo upload shrunk to WebP in the browser and inline stock; customers; read-only settings.
- **Adapters**: data (`json`, `supabase`, `postgres`), payments (`manual`, `mercadopago`,
  `stripe`), e-mail (`console`, `resend`, `smtp`), storage (`local`, `supabase`), antibot
  (`none`, `turnstile`).
- **Shared SQL schema** (`db/schema.sql`): row level security, public read views, `create_order`
  with server-side prices and an idempotency key, `record_payment` that credits once, and the
  admin functions.
- **SEO and AI**: metadata on every page, Open Graph image, `Organization`/`OnlineStore` and
  `WebSite` structured data, sitemap, robots (private routes blocked, AI crawlers welcome),
  `/llms.txt` and `/llms-full.txt`, Google Merchant and Meta feeds, IndexNow, configurable 301s.
- **Measurement**: GA4, Meta pixel + Conversions API with a shared `event_id`, Clarity, UTM
  attribution, consent banner. Off outside production. `purchase` is sent by the server once per
  order.
- **i18n**: `es` and `en` dictionaries and localized routes, chosen in `config/brand.ts`.
- **The brain** (`cerebro/`): source, builder and generated static site.
- **Project**: MIT licence, contributing guide, code of conduct, security policy, issue and pull
  request templates, CI, Dockerfile, bilingual docs, `llms.txt` for the repository, brand check.
- **Tests**: Vitest unit tests (including the real SQL on an in-process PostgreSQL) and
  Playwright end-to-end tests on phone and computer sizes.

[Unreleased]: https://github.com/FacundoEquiss/cerebro-web/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/FacundoEquiss/cerebro-web/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/FacundoEquiss/cerebro-web/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/FacundoEquiss/cerebro-web/releases/tag/v0.1.0
