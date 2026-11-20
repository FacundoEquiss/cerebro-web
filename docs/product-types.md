**English** · [Español](product-types.es.md)

# Product types

Cerebro Web is a base for **any line of business**. What makes that possible is one field of the
product, `type`, plus a way of selling by weight or measure. This page says what each type does,
what you configure, and what the server guarantees.

| `type` | What it is | The product page asks for | Shipping | After the payment |
|---|---|---|---|---|
| `physical` | A thing that is shipped or picked up (the default) | Options, quantity | Yes | The order is prepared |
| `digital` | A file | Nothing (one per order line) | No | A signed download link that expires |
| `service` | An appointment — or an **event** with fixed dates | Day and time, or one of the dates (and places) | No | The slot is already reserved |
| `quote` | Something without a public price | Quantity and a description | Set by the owner | — it is paid after the quote is accepted |

Three rules hold for all of them, and they are the same in `lib/orders/pricing.ts` (the `json`
adapter) and in `create_order()` (`db/schema.sql`, the database adapters):

1. **The server sets the price.** The browser sends ids, quantities and, for a service, the slot.
   Never an amount.
2. **Shipping only if something is shipped.** An order without a physical product has the method
   `none`, asks for no address and costs no shipping — whatever the browser sent.
3. **A cart can mix types.** One download, one appointment and one mug are one order.

## These three need a store that remembers orders

A slot is reserved by a **stored** order, a quote is priced on a **stored** enquiry and a file is
delivered when a **stored** order is paid. So `service`, `quote` and `digital` products need a
data adapter that stores orders: `supabase`, `postgres`, or `json` on a machine you run yourself
with a writable `DATA_DIR`. **`json` in production stores nothing** (`APP_ENV=production`, or any
deployment on Vercel) — it is the adapter of the demo.

What happens without one (`lib/store-mode.ts`):

| | The store | The server |
|---|---|---|
| **A real store** (not demo mode) | The product page shows no calendar, no quote form and no "add to cart" for those products: it says so and offers WhatsApp and the contact page | `POST /api/orders` and `POST /api/quotes` answer `409 needs_store` |
| **Demo mode** (`DEMO_MODE`, the published demo) | The flows can be tried, and the product page and the order page say that nothing is stored: the slot is **not** really held, the enquiry reaches nobody, the download is not delivered. No seat is shown as taken | Orders are priced and answered, never stored |

Physical products are not affected: they can always be sold with the signed receipt as the only
copy of the order.

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
- It needs an adapter that **stores orders**: a database, or `json` **outside production** with a
  writable `DATA_DIR`. `json` with `APP_ENV=production` (or on Vercel) stores nothing, whatever
  the disk: nothing can tell whether an order was paid, so nothing is delivered — see the section
  above.
- A download is **one per order line** (the server rejects a quantity other than 1).
- The file is **streamed**, never loaded whole in memory. On serverless hosting the platform
  still limits how big a response may be and how long it may take (a few MB and seconds on the
  smallest plans): for big files use a server you run, or raise those limits.
- With `STORAGE_PROVIDER=supabase` the server **checks that the bucket is private** before the
  first private read or write (and again every 10 minutes). A public bucket — or one whose
  settings cannot be read — is refused: nothing is served and the log says why.
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
- **Daylight saving**: a time the clocks skip that day (02:30 when they jump from 02:00 to 03:00,
  or 00:30 in a zone that switches at midnight) is not offered; an hour that happens twice is
  always the first of the two.
- **Reservation** (with an adapter that stores orders — see above): the slot is reserved when the
  order is **created**. The server first checks that the slot is one the service really offers now
  (`lib/booking/slots.ts`), then `create_order()` checks the capacity with the product row locked
  — two simultaneous orders cannot take the last seat — and the same idempotency key always
  returns the same order.
- **Capacity counts what overlaps**, not what starts at the same minute: if you change the
  duration of a service, the appointments already taken still block the time they occupy. It is
  **one calendar per product**: two services do not block each other, and there is no calendar
  per member of staff or per room (on the roadmap).
- **Holds**: an unpaid order keeps its slot for `booking.holdHours` (12 by default; the variable
  `BOOKING_HOLD_HOURS` overrides it) — shorter than `ORDER_EXPIRY_HOURS` on purpose. When the hold
  lapses the seat is free **at once**: every read (the calendar, the Agenda, a new order) stops
  counting it, with nothing to run. The order itself is cancelled by the usual clean-up (lazily,
  and by the cron route). Paid bookings never lapse.
- **Limits**: one order may contain `booking.maxSlotsPerOrder` appointments (3), and one buyer —
  by e-mail — may hold `booking.maxUnpaidPerBuyer` unpaid ones at a time (3). Seats are whole.
- **Release**: a booking is a service line of an order that is not cancelled. Cancelling the
  order frees the seat by itself.
- **Agenda**: `/admin/agenda`, by day or by week (see [`admin.md`](admin.md)). The slot is also on
  the kanban card and in the order detail.
- **What is not built**: reminders, rescheduling by the customer, one calendar per member of
  staff, calendar sync, deposits. See [`ROADMAP.md`](../ROADMAP.md).

## Events: its own dates and limited places

A workshop, a one-off class, a talk, a ticket: it does not happen "every Monday from 9 to 18", it
happens on **its own dates**. It is a service with a rule that repeats, a list of dates, or both:

```jsonc
{
  "id": "cooking-workshop", "type": "service", "price": 32000,
  "service": {
    "durationMinutes": 180,
    "capacity": 12,                                   // places of EACH date
    // "The first Saturday of each month at 10:00", with the next 3 dates open:
    "repeat": { "week": 1, "weekday": "sat", "time": "10:00", "count": 3 },
    // …and/or single dates. A date may have its own length:
    "sessions": [{ "start": "2027-03-20T18:00", "durationMinutes": 240 }],
    "blockedDates": ["2027-01-02"]                    // a day with no event (a closed day wins)
  }
}
```

- **`repeat`** — `week` is `1`, `2`, `3`, `4`, `"last"` (of each month) or `"every"` (every week);
  `weekday` is `mon`…`sun`; `time` is wall time of `booking.timeZone`; `count` is how many upcoming
  dates are open at once (default 3, at most 24). The dates are worked out from today, so the
  event **never runs out of dates** and nobody has to load them again.
- **`sessions`** — explicit dates, for what does not follow a rule. Both add up; a date written
  twice is one date.
- **A closed day wins.** A day in `blockedDates` — the product's ("Skip these dates" in the
  editor) or the store's (`commerce.booking.blockedDates`) — has no event: the rule skips it and
  moves on to the next date, and a date of `sessions` on that day is not offered.
  `npm run check:catalog` and the editor name that contradiction.
- In the admin panel: **Type → Service**, then **How it is booked → Event or workshop**. There
  you choose the repetition and type single dates, one per line (`2027-03-20 18:00`, plus the
  minutes at the end when that date has another length: `2027-03-20 18:00 240`).
- **An event stays an event with no date left**: the store says "There are no open dates for now"
  instead of falling back to the weekly agenda. `npm run check:catalog` warns about it.
- The weekly agenda, the notice and the calendar window do not apply to an event.
- The store shows a **list of dates** with "N places left" and the button **Sign up**; the quantity
  is the number of places. A date that passed stops being offered on its own.
- Everything else is the booking engine of the section above: places reserved when the order is
  created (no overselling), holds that lapse, the limits per order and per buyer, the Agenda (with
  **Next event** and **Go to a date**), and the need for an adapter that stores orders.
- **Moving or removing a date that has sign-ups**: the bookings stay in their orders and in the
  Agenda. The panel warns when you save, naming the date and the places; those people have to be
  told by the owner.
- **Two dates of one event that overlap share the places** (the engine counts seats per product
  and time). `npm run check:catalog` warns. Two activities at the same time are two products.
- Structured data: one `Event` per upcoming date (start, end, price), with `SoldOut` when the
  date is full. `location` is only stated when `brand.contact.address` is set — it is never made up.
- `npm run check:catalog` also warns about a date written twice and about a date at an hour the
  clocks skip that day (daylight saving): nobody could sign up for it.
- **Not built**: a waiting list, tickets with a code to check at the door, a different price or
  number of places per date. See [`ROADMAP.md`](../ROADMAP.md).

## Drafts: a product without a price

When the owner has not given a price yet, **do not invent one**. Load the product as a draft:
`"price": null` in the catalogue file, or the box **Draft** in the admin panel.

- A draft is **not for sale**: it is hidden from the store, the search, the sitemap, the feeds,
  `llms.txt` and the structured data, and the server refuses any order that includes it.
- The admin panel lists it with **Price missing**. `npm run check:catalog` and `npm run doctor`
  list every draft: that is the list of questions for the owner.
- When the price arrives, type it and untick the box. The price box of a draft starts empty, and
  **price 0 is refused on anything that is for sale** (by the form and by the server): 0 is an
  empty field. A product that is free on purpose says so: see **Free products** below.
- **A quote is the exception.** `type: "quote"` has no public price by nature, so `"price": null`
  (or `0`) there is normal: the product is on show, with its enquiry form. To hide a quote that is
  not ready, mark it `"draft": true`.

## Free products

A free download, a sample, an open class: price 0 **on purpose**. Say so — `"free": true` in the
catalogue file, or the box **Free** in the product editor:

```jsonc
{ "id": "starter-guide", "type": "digital", "price": 0, "free": true, "digital": { "name": "guide.pdf", "file": "guide.pdf" } }
```

- The store shows **Free** instead of an amount. It is ordered like any product (the owner gets
  the buyer's contact details). When the whole order adds up to 0 the checkout asks for no way of
  paying and the order is **confirmed at once** — a free download is available right there.
- Mixed with paid products it is one more line at 0; the order is paid as usual.
- **Price 0 without `free` is refused**: by the form, the server, the database and
  `npm run check:catalog` (an error that names the product). An unmarked 0 is taken for an empty
  field, and the store keeps that product off sale. Free means 0: `free` with a price is an error.
- Shopping feeds leave free products out (they need a real price). The structured data states
  price 0.
- A database needs `db/migrations/0004_free.sql`.

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
- **A quote that charges shipping asks for the delivery address** when the customer accepts it,
  and is not accepted without it.
- **Delivering the quote**: sending it e-mails the customer **if a mail provider is set up**; the
  panel says whether the e-mail really went out. Either way the quote editor shows the customer's
  signed link, with a button to copy it and one to send it by WhatsApp.
- The free text of an enquiry never travels in the order link: the page reads it from the store.

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
npm run preset moda -- --force        # …over a catalogue that is already yours
```

**It replaces files, so it protects your work.** It refuses to run — unless you pass `--force` —
when `content/products.json`, `content/site.json` or the colours of `config/brand.ts` are no
longer a preset's, or when those files (or `db/seed.sql`) have uncommitted changes. Before writing
it always copies what was there to `.preset-backups/<date-time>/` (one folder per run, never
overwritten, ignored by git), and it sets aside the local `catalog.json` and `orders.json` of
`DATA_DIR`, which would point at products that no longer exist.

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

**The tests do not depend on the catalogue.** They run against `tests/fixtures/`, so
`npm test` and `npm run test:e2e` stay green after any preset and with any catalogue of your own.
What checks YOUR catalogue is `npm run check:catalog` (part of `npm run check`).

To add a preset: copy one, change it, run `npm run images` (new shapes go in
`scripts/generate-images.mjs`) and `npm test` (every preset is validated).

## Upgrading from 0.1.0

See the migration notes in [`CHANGELOG.md`](../CHANGELOG.md#020---2026-11-20).
