**English** · [Español](AGENTS.es.md)

# Instructions for agents

You are working on **Cerebro Web**, or on the website of a business made from it: a Next.js store
+ an admin panel + a guide ("the brain"). The owner of the business does not program. They will
ask you for outcomes ("adapt this to my business", "add free shipping over X"); you do the work
**and verify it**.

## 0. Read the brain first

`cerebro/` holds the guide for building, launching and growing a business website (316 nodes, in
Spanish). Before your first change:

1. Read `cerebro/dist/llms-full.txt` — at least the branch **«Cómo usar este cerebro»** and the
   **essential** nodes of the phase you are in. (Online: <https://cerebro-web-negocios.vercel.app/llms-full.txt>.)
2. Read [`GETTING-STARTED.md`](GETTING-STARTED.md): the ordered checklist to turn this template
   into a real site, split into what you do and what only the owner can do.
3. Come back here for the rules of this codebase.

When the brain and a habit of yours disagree, the brain wins. When the brain and the **code**
disagree, check the code: it is what runs.

## 1. Rules that always apply

1. **Never invent business data.** Prices, stock, addresses, opening hours, shipping costs,
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
8. **No trace of any private brand** in this template: `npm run check` enforces it. Examples use
   `example.com`.
9. **English for code, comments and commits.** UI texts go in **both** `i18n/es.ts` and
   `i18n/en.ts`. Docs are bilingual (`X.md` and `X.es.md`).
10. **Ask before**: publishing, spending money, sending messages to real people, changing
    production data or running a migration on a real database.

## 2. Where everything lives

| Path | What |
|---|---|
| `config/` | `brand.ts` (the brand, in one place), `commerce.ts` (commercial rules), `fonts.ts`, `redirects.ts` |
| `content/products.json` | The demo catalogue (the `json` data adapter) |
| `i18n/` | `es.ts`, `en.ts` (dictionaries), `routes.ts` (public URL of each page per language) |
| `app/(store)/` | Storefront pages. Folders are the English routes; other languages are rewritten |
| `app/admin/` | Admin panel: `login`, `(panel)/` (kanban, summary, products, customers, settings), print pages |
| `app/api/` | `orders` (create), `payments/[provider]/webhook`, `events`, `admin/*` |
| `app/robots.ts`, `sitemap.ts`, `llms.txt`, `llms-full.txt`, `feeds/` | Search engines, AI assistants, product feeds |
| `components/` | By domain: `layout`, `catalog`, `product`, `cart`, `checkout`, `admin`, `analytics` |
| `lib/data/` | Data adapters: `types.ts` (the contract), `json.ts`, `sql.ts` + `supabase.ts` / `postgres.ts` |
| `lib/orders/` | `pricing.ts`, `idempotency.ts`, `receipt.ts` (signed order link), `status.ts` (the workflow) |
| `lib/payments/` | `manual`, `mercadopago`, `stripe`, `credit.ts` (credit a payment once) |
| `lib/admin/` | `auth.ts`, `session.ts`, `password.ts`, `login.ts`, `orders.ts`, `reports.ts`, `products.ts` |
| `lib/analytics/`, `lib/feeds/`, `lib/seo.ts`, `lib/indexnow.ts` | Measurement, feeds, metadata and structured data |
| `db/schema.sql`, `db/seed.sql` | The shared SQL schema (Supabase and plain PostgreSQL) and the demo data |
| `proxy.ts` | Guards `/admin` and `/api/admin` |
| `stores/` | Browser state (the cart) |
| `scripts/` | `check-brand`, `check-i18n`, `admin-hash`, `generate-images`, `generate-seed`, `screenshots` |
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
- **A schema change** goes in `db/schema.sql`, must be safe to run twice, and is tested in
  `tests/sql.test.ts`. Never run it on a real database without the owner's approval.

## 4. Verify — it is not optional

```bash
npm run check       # no private brand, dictionaries in step
npm run typecheck
npm test
npm run build
npm run test:e2e    # the production build, in a real browser, phone and computer
```

Then look at it: `npm run screenshots` saves every key screen and fails on console errors. If you
changed the purchase flow, buy something end to end. Say what you verified and what you could
**not** verify (a real payment, a real database, a real e-mail) — never present an assumption as
a fact.

## 5. What to hand back

A short summary: what changed, how you verified it (with numbers), what is pending and who has to
do it (you or the owner), and anything that needs their approval.
