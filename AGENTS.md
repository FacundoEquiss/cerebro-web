**English** · [Español](AGENTS.es.md)

# Instructions for agents

You are working on **Cerebro Web**, or on the website of a business made from it: a Next.js store
+ an admin panel + a guide ("the brain"). The owner of the business does not program. They will
ask you for outcomes ("adapt this to my business", "add free shipping over X"); you do the work
**and verify it**.

## 0. Read the brain first

`cerebro/` holds the guide for building, launching and growing a business website (334 nodes, in
Spanish). Before your first change:

1. Read `cerebro/dist/llms-full.txt` — at least the branches **«Cómo usar este cerebro»** and
   **«Adaptar a tu rubro»** (which preset and product type fit the business), and the
   **essential** nodes of the phase you are in. (Online: <https://cerebro-web-negocios.vercel.app/llms-full.txt>.)
2. Read [`GETTING-STARTED.md`](GETTING-STARTED.md): the ordered checklist to turn this template
   into a real site, split into what you do and what only the owner can do. To take it live —
   database, variables, admin user, payments, e-mail, domain — follow
   [`docs/go-live.md`](docs/go-live.md) and run `npm run doctor` after each step.
3. Come back here for the rules of this codebase.

When the brain and a habit of yours disagree, the brain wins. When the brain and the **code**
disagree, check the code: it is what runs.

## 1. Rules that always apply

1. **Never invent business data.** When a PRICE is unknown, load the product as a **draft**
   (`"price": null`, or the draft box in the panel): it is not sold and not shown, and
   `npm run check:catalog` lists it for the owner. Never a placeholder amount. Prices, stock, addresses, opening hours, shipping costs,
   return policies, reviews, instalments: if the owner did not give it to you, it is `null`,
   "FILL IN" or a question for them. The template is full of placeholders marked EXAMPLE on purpose.
2. **The server sets the price.** The browser sends product ids and quantities. Totals are
   calculated in `lib/orders/pricing.ts` or in `create_order()` (`db/schema.sql`). Never trust,
   store or forward an amount that came from a browser.
3. **One source for each fact.** Brand, contact and colours: `config/brand.ts`. Shipping,
   minimums, lead times: `config/commerce.ts`. Texts: `i18n/`. Routes: `i18n/routes.ts`. If the
   same number is typed in two places, one of them is already wrong.
4. **Only through the adapters.** Pages and routes never import a database client: they call
   `lib/data` (and `lib/payments`, `lib/mail`, `lib/storage`). See [`docs/adapters.md`](docs/adapters.md).
5. **Every admin page and route checks the session by itself** (`getSession`, `requireAdmin`,
   `requireWriter` in `lib/admin/auth.ts`). The proxy is a first barrier, not the only one.
6. **Measurement is off outside production** and never runs without the visitor's consent. The
   `purchase` event is sent by the server, once per order, with the order id as `event_id`.
7. **No secrets in the repo, the browser or the logs.** Secrets are server-side environment
   variables validated in `lib/env.ts`. A `NEXT_PUBLIC_` variable is public.
8. **No trace of any private brand in the TEMPLATE**: examples use `example.com`, and the brand
   scan of `npm run check` enforces it in the template's own repository (in its CI, and on a
   machine that has a `.brand-blocklist`). **In a store it is skipped**: a real store carries its
   real e-mail, phone and bank details in `config/`, and its check, build and CI accept them.
9. **English for code, comments and commits.** UI texts go in **both** `i18n/es.ts` and
   `i18n/en.ts`. Docs are bilingual (`X.md` and `X.es.md`).
10. **Ask before**: publishing, spending money, sending messages to real people, changing
    production data or running a migration on a real database.

## 2. Where everything lives

| Path | What |
|---|---|
| `config/` | `brand.ts` (the brand, in one place), `commerce.ts` (commercial rules), `fonts.ts`, `redirects.ts` |
| `content/products.json` | The catalogue in use (the `json` data adapter). The demo is the `mixto` preset |
| `content/presets/` | Starting catalogues per line of business; `npm run preset <name>` applies one |
| `content/site.json` | Which preset was applied and the home texts (hero, benefits, questions) |
| `content/downloads/` | Example files of the digital products (private: never under `public/`) |
| `i18n/` | `es.ts`, `en.ts` (dictionaries), `routes.ts` (public URL of each page per language) |
| `app/(store)/` | Storefront pages. Folders are the English routes; other languages are rewritten |
| `app/admin/` | Admin panel: `login`, `(panel)/` (kanban, summary, products, customers, settings), print pages |
| `app/api/` | `orders` (create), `payments/[provider]/webhook`, `events`, `admin/*` |
| `app/robots.ts`, `sitemap.ts`, `llms.txt`, `llms-full.txt`, `feeds/` | Search engines, AI assistants, product feeds |
| `components/` | By domain: `layout`, `catalog`, `product`, `cart`, `checkout`, `admin`, `analytics` |
| `lib/data/` | Data adapters: `types.ts` (the contract), `json.ts`, `sql.ts` + `supabase.ts` / `postgres.ts` |
| `lib/orders/` | `pricing.ts`, `idempotency.ts`, `receipt.ts` (signed order link), `status.ts` (the workflow), `download.ts` (signed download link) |
| `lib/booking/` | `slots.ts`: the slots of a service (opening hours, time zone, capacity) |
| `lib/payments/` | `manual`, `mercadopago`, `stripe`, `credit.ts` (credit a payment once) |
| `lib/admin/` | `auth.ts`, `session.ts`, `password.ts`, `login.ts`, `orders.ts`, `quotes.ts`, `reports.ts`, `products.ts` |
| `lib/analytics/`, `lib/feeds/`, `lib/seo.ts`, `lib/indexnow.ts` | Measurement, feeds, metadata and structured data |
| `db/schema.sql`, `db/seed.sql` | The shared SQL schema (Supabase and plain PostgreSQL) and the demo data |
| `db/migrations/` | One file per schema change, for databases that already exist |
| `proxy.ts` | Guards `/admin` and `/api/admin` |
| `stores/` | Browser state (the cart) |
| `scripts/` | `check-brand`, `check-i18n`, `admin-hash`, `preset`, `generate-images`, `generate-samples`, `generate-seed`, `screenshots` |
| `tests/fixtures/` | The store the tests run against (catalogue, home texts, brand, commercial rules, images, sample files) — never the owner's files |
| `packages/create-cerebro-web/` | The one-command creator (`npm create cerebro-web`), not published to npm yet |
| `tests/`, `e2e/` | Vitest unit tests, Playwright end-to-end tests |
| `cerebro/` | The brain: `datos.json` (source), `armar.mjs` (builder), `dist/` (generated, committed) |

## 3. How to work

- **Inspect before you build.** Run the site and look at the screen you are about to change, on a
  phone size and a computer size.
- **Design tokens, not literals.** Colours come from the eight values of `config/brand.ts`
  (`app/globals.css` derives the rest). CSS Modules per component; one breakpoint (768 px), mobile
  first. Icons: `lucide-react`. No CSS framework, no UI library.
- **Touch.** Do not build custom touch gestures (drag to close, swipe to move): they fight the
  scroll. Use native controls. A horizontal scroll-snap rail needs `scroll-padding` equal to its
  padding. Never put `overflow-x: hidden` on an ancestor of something sticky — use `clip`.
- **A new page** needs `generateMetadata` (use `pageMetadata` from `lib/seo.ts`), one `h1`, its
  route in `i18n/routes.ts` if it is public, and a decision about `robots` and the sitemap.
- **A changed URL** needs a 301 in `config/redirects.ts`.
- **A new environment variable** is added to `lib/env.ts` (validated) and `.env.example` (explained).
- **A schema change** goes in `db/schema.sql` **and** in a new file of `db/migrations/`, must be
  safe to run twice, and is tested in `tests/sql.test.ts` (including the upgrade of a database
  made with the previous version). Never run it on a real database without the owner's approval.

## 4. Verify — it is not optional

```bash
npm run check       # dictionaries in step, YOUR catalogue is valid (+ the brand scan, in the template only)
npm run typecheck
npm test
npm run build
npm run test:e2e    # the production build, in a real browser, phone and computer
```

**The tests have their own store.** The unit tests and the end-to-end tests run against
`tests/fixtures/` — its own catalogue, home texts, brand, commercial rules, product images and
sample files — and never against `content/products.json`, `content/site.json`, `config/brand.ts`,
`config/commerce.ts`, `public/products/` or `content/downloads/`. So they stay green whatever the
business sells: after `npm run preset <name>`, with a catalogue made by hand, and after deleting
the example images and files. If a test fails, the CODE changed, not the catalogue.

`npm run test:e2e` builds that test store into `.next-fixtures/` (ignored by git): `.next/` is
always YOUR store, so `npm start` after the tests serves the real one.

**After changing the catalogue** (products, categories, home texts), run:

```bash
npm run check:catalog   # broken references, drafts without a price, EXAMPLE texts left
npm run build           # every product page builds
npm run doctor          # what is still missing before selling
```

and look at the store. Change `tests/fixtures/` only when you change what the code does — together
with the tests that name its products.

Then look at it: `npm run screenshots` saves every key screen and fails on console errors. If you
changed the purchase flow, buy something end to end. Say what you verified and what you could
**not** verify (a real payment, a real database, a real e-mail) — never present an assumption as
a fact.

## 5. What to hand back

A short summary: what changed, how you verified it (with numbers), what is pending and who has to
do it (you or the owner), and anything that needs their approval.

## 6. Adapting it to a line of business

This is a **base to be modified end to end**, not a theme: design, texts, purchase flow, data
model and admin panel are all yours to change. The demo (a mixed catalogue) is one example.

**Start from the preset, not from the demo.**

1. `npm run preset` lists the starting catalogues; `npm run preset <name>` applies the one closest
   to the business (products, categories, home texts, a suggested palette). Read the node of that
   line of business in the brain, branch **«Adaptar a tu rubro»**.
2. Give every product its **type** — `physical`, `digital`, `service` (an appointment, or an
   **event** when it has its own dates: `service.repeat` or `service.sessions`) or `quote` — and, when it is
   sold by weight or measure, its `unit`, `step` and minimum. [`docs/product-types.md`](docs/product-types.md)
   says what each one does and what the server guarantees.
3. Replace **every** EXAMPLE with what the owner confirmed. A preset's prices, opening hours,
   policies and texts are placeholders: publishing them is inventing business data (rule 1).
4. Ask the owner what only they know for that business: cancellation and return policies, lead
   times, what happens when the real weight differs, licences of digital files, and which
   permits or rules apply to what they sell. Never assume a regulation.

**If the business needs something that does not exist**, extend the base without breaking its
contract:

1. Look first: [`README.md`](README.md#which-businesses-it-fits) and [`ROADMAP.md`](ROADMAP.md) say
   what is built and what is not. Tell the owner plainly when something is not built.
2. Try what is there: a type, a unit, options, `attributes`, texts and `config/commerce.ts` solve
   more cases than it seems.
3. A new field or type goes through the whole chain, in this order: `lib/data/types.ts` → the pure
   rule in `lib/orders/` → `db/schema.sql` + a migration in `db/migrations/` → the three data
   adapters (`json.ts`, and `sql.ts` for the two databases) → the screens → `i18n/es.ts` and
   `en.ts` → the docs and `CHANGELOG.md` with migration notes.
4. Keep the invariants: the server sets every amount; whatever must not be oversold (stock, a
   slot) is checked where the order is created, atomically; a private file never gets a public
   address; nothing is credited without a verified payment for the exact total.
5. Every new field has a default, so existing data keeps working, and every new adapter method
   is implemented in all three adapters (TypeScript will tell you which are missing).
6. Test it at three levels — the pure rule, the SQL on PGlite, and end to end on a phone and a
   computer — before saying it works.
