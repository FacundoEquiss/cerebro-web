**English** · [Español](GETTING-STARTED.es.md)

# Getting started: from template to a real business website

This is the ordered checklist. Each step says **who** does it:

- 🤖 **Agent** — can be done from the repository.
- 🧑 **Owner** — needs a decision, an account, money or real data only the owner has.

The agent should ask for everything in the 🧑 column **in one batch** at the start (see the brain,
«Preguntar sólo lo necesario»), and never fill a gap with an invented value.

## 0. Before touching anything

| | Who | What |
|---|---|---|
| ☐ | 🤖 | Read `AGENTS.md` and the essential nodes of `cerebro/dist/llms-full.txt`. |
| ☐ | 🤖 | Run it: `npm install && npm run dev`. Buy something in the demo; open `/admin`. |
| ☐ | 🧑 | Answer the business sheet: what you sell, to whom, country, currency, how you deliver, how you charge, contact channels. |
| ☐ | 🤖 | **First step: choose the preset closest to the line of business.** `npm run preset` lists them (fashion, home, technology, pantry by weight, food, services by appointment, digital products, made-to-measure work, or the mixed demo); `npm run preset <name>` applies it. It replaces the catalogue, the home texts and the palette with **examples** for that business — a starting point, to be rewritten in the steps below. See [`docs/product-types.md`](docs/product-types.md). |

## 1. Brand

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Name, tagline, logo (if any), colours or a reference you like, contact details, social profiles. |
| ☐ | 🤖 | Fill `config/brand.ts`: name, tagline, description, `locale` (`es` or `en`), country, currency, contact, social, the 8 theme colours. Check contrast (4.5:1 for text). |
| ☐ | 🤖 | Fonts in `config/fonts.ts` (any open-licence family). Replace `app/icon.svg`. Review `app/opengraph-image.tsx`. |
| ☐ | 🤖 | Rewrite the home texts, benefits and FAQ in `content/site.json` (written by the preset; the fallback texts are in `i18n/<locale>.ts`) with **real** facts. Remove every "EXAMPLE". |

## 2. Commercial rules

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Shipping methods and prices, free-shipping threshold, minimum order, preparation time, bank details for transfers, whether you offer instalments. |
| ☐ | 🤖 | Fill `config/commerce.ts`. Anything not confirmed stays off (`enabled: false`) or `null`. |
| ☐ | 🧑 | **If you sell services**: opening hours per weekday, closed days, time zone, how much notice you need, how far ahead you take bookings, and your cancellation policy. |
| ☐ | 🤖 | Fill `booking` in `config/commerce.ts` (and `service.weekly` on a product with its own hours). Book a slot and find it in `/admin/agenda`. |
| ☐ | 🧑 | **If you sell by weight**: what happens when the real weight differs from the order. **If you sell digital files**: the licence and the refund policy. **If you quote**: how long a quote is valid and whether you ask for a deposit. |

## 3. Products and photos

| | Who | What |
|---|---|---|
| ☐ | 🧑 | The product list: name, description, **type** (physical, digital, service, on a quote), price and unit (piece, kg, m…), list price, options (sizes, colours…), stock; for a service, its duration and seats per slot; for a digital product, the file. Photos you own the rights to (see the brain, «Multimedia»). |
| ☐ | 🤖 | Load them: edit `content/products.json`, or — with a database — create them in `/admin/products`. Photos uploaded in the panel are shrunk to WebP (1600 px) and need alternative text. |
| ☐ | 🤖 | Upload the file of each digital product from the panel (it goes to the private storage, never to `public/`). Buy one, mark it paid, download it. |
| ☐ | 🤖 | Delete the example products, `public/products/*.svg`, `content/downloads/` and — once the store is yours — `content/presets/`. Check a product with options but no variants still forces the choice. |

## 4. Database (to store orders and stock)

`json` mode stores nothing in production. To sell for real:

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Create a Supabase project **or** a PostgreSQL 14+ database. Hand over the connection data through the hosting's secret settings — never in chat or in the repo. |
| ☐ | 🤖 | Run `db/schema.sql` (and `db/seed.sql` only if you want the demo catalogue). **Ask before running it on a database that already has data.** |
| ☐ | 🤖 | Set `DATA_SOURCE=supabase` (+ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) or `DATA_SOURCE=postgres` (+ `DATABASE_URL`). |
| ☐ | 🤖 | Photos: `STORAGE_PROVIDER=supabase` with a **public** bucket, or `local` on a server with a persistent disk. |
| ☐ | 🧑 | Turn on automatic backups in the database provider. |

## 5. Secrets and the admin user

| | Who | What |
|---|---|---|
| ☐ | 🤖 | Generate `ORDER_SECRET` and `ADMIN_SESSION_SECRET` (32+ random characters each). |
| ☐ | 🧑 | Run `npm run admin:hash` yourself and choose your password (the agent must not know it). Paste the line in `ADMIN_USERS`. |
| ☐ | 🤖 | Set `DEMO_MODE=false`. Check `/admin/login` no longer shows demo credentials. |

## 6. Payments

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Decide: `manual` (transfer / arrange by WhatsApp — works today, no fees) or a gateway (`mercadopago`, `stripe`). Create the account and its credentials. |
| ☐ | 🤖 | Set `PAYMENT_PROVIDER` and its keys. Register the webhook URL `https://<domain>/api/payments/<provider>/webhook` in the gateway and set its secret. |
| ☐ | 🧑🤖 | **One real payment, end to end**, with a small amount: pay, see the order move to «Paid» on the kanban, refund it. A sandbox is not enough. |

## 7. E-mail and notifications

| | Who | What |
|---|---|---|
| ☐ | 🧑 | An account with a mail service (or SMTP data) and the address that sends. |
| ☐ | 🤖 | `MAIL_PROVIDER`, its key, `MAIL_FROM`, `ORDER_NOTIFY_EMAIL`. Place a test order and confirm both e-mails arrive. |

## 8. Legal pages

| | Who | What |
|---|---|---|
| ☐ | 🧑 | The real terms, privacy policy and returns policy, reviewed for your country. |
| ☐ | 🤖 | Replace the templates (`i18n` → `legal`, pages under `app/(store)/terms`, `privacy`, `returns`) and remove their `noindex`. **Do not write legal conditions on your own.** |

## 9. Domain and hosting

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Buy the domain; choose where to host (see `docs/deploy.md`). |
| ☐ | 🤖 | Deploy. Set `NEXT_PUBLIC_SITE_URL` and `APP_ENV=production` (automatic on Vercel). HTTPS on. |
| ☐ | 🤖 | If the business had an old site: map every old URL to the new one in `config/redirects.ts`. |
| ☐ | 🤖 | Final review on a real phone. Then `ALLOW_INDEXING=1`. |

## 10. Search engines and catalogues

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Verify the domain in Google Search Console and Bing Webmaster Tools. Create the business profile if there is a physical shop. |
| ☐ | 🤖 | Submit `https://<domain>/sitemap.xml`. Set `INDEXNOW_KEY`. Check `/robots.txt`, `/llms.txt`, a product page in the rich-results test. |
| ☐ | 🧑🤖 | Merchant Center: add the feed `https://<domain>/feeds/google.xml`. Meta catalogue: `https://<domain>/feeds/meta.xml`. (They are different files on purpose.) |

## 11. Measurement

| | Who | What |
|---|---|---|
| ☐ | 🧑 | Create the Analytics property, the pixel and its Conversions API token (and Clarity, if wanted). |
| ☐ | 🤖 | Set `NEXT_PUBLIC_GA4_ID`, `GA4_API_SECRET`, `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_TOKEN`, `NEXT_PUBLIC_CLARITY_ID`. They only run in production and after the visitor accepts. |
| ☐ | 🤖 | Verify in each platform's test tool: `view_item`, `add_to_cart`, `begin_checkout`, and **one** `purchase` per order when it becomes «Paid». |

## 12. Launch

Follow the brain's «Checklist de lanzamiento» and «Plan de 90 días». The **Settings** screen of
the panel (`/admin/settings`) lists what is still missing for real use.
