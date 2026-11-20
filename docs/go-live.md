**English** · [Español](go-live.es.md)

# From zero to selling

This guide takes a store made with Cerebro Web from "it runs on my computer" to "it takes real
orders". It is written so that **an AI agent can lead the owner by the hand**: each step says what
to ask the owner (🧑), what the agent does (🤖), and how to know it worked (✅).

Three rules for the agent:

1. **Run `npm run doctor` first, and after every step.** It reads the configuration and says what
   is ready and which single step comes next. (It reads `.env.local`; for a store already on a
   hosting service, download its variables first — on Vercel, `vercel env pull .env.local`.)
2. **Keys are created and pasted by the owner**, in the hosting service's settings. They never go
   in the repository, and the owner should not paste them in a chat either.
3. **The screens of each provider change.** This guide names what to look for, not where every
   button is; each step links the provider's official documentation. When a name does not match,
   trust their page.

You do not need every step to start: steps 1 to 6 give a store that stores orders and charges by
bank transfer or message. Cards (7), e-mail (8) and the domain (9) can come right after.

## 0. Before starting

- 🧑 Have an e-mail account for the business, and decide who will hold the accounts (they are the
  owner's, not the agent's).
- 🤖 The store is already adapted: brand, catalogue and commercial rules
  ([`GETTING-STARTED.md`](../GETTING-STARTED.md)), **with the real data**: the real e-mail,
  WhatsApp, address and bank details go in `config/brand.ts` and `config/commerce.ts`.
  `npm run check` and `npm run build` accept them — the scan for "private brand data" protects
  the template's repository only and is skipped in a store. `npm run check` passes.
- 🤖 The code is in a GitHub repository of the owner (the hosting service deploys from there):
  <https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository>.

## 1. A database, to keep the orders

Without a database the store keeps nothing: it is the demo mode. Services, events, quotes and
digital products **need** one.

- 🧑 Create a free account and a project at Supabase — <https://supabase.com/docs/guides/getting-started>.
  Choose a region close to the customers and save the database password somewhere safe.
  (Any PostgreSQL works too: set `DATA_SOURCE=postgres` and `DATABASE_URL` instead.)
- 🧑 From the project's API settings copy three values — the project URL, the public ("anon" /
  publishable) key and the secret ("service role") key:
  <https://supabase.com/docs/guides/api/api-keys>. The secret key is a password: it only goes in
  the hosting service's variables.
- ✅ You have: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Load the schema

- 🤖 Open the project's SQL editor (<https://supabase.com/docs/guides/database/overview>), paste
  the whole of [`db/schema.sql`](../db/schema.sql) and run it. It can be run twice.
- 🤖 To start with the products of `content/products.json`, run `npm run db:seed` and then paste
  and run [`db/seed.sql`](../db/seed.sql). From then on products are edited in `/admin/products`.
- ✅ The tables `products`, `orders` and the others exist, and `select count(*) from products`
  answers.

## 3. The private bucket (only if you sell digital files)

- 🧑 In Storage create a bucket named `downloads` and leave it **private** (not public):
  <https://supabase.com/docs/guides/storage/buckets/fundamentals>. For product photos create
  another one, `products`, **public**.
- 🤖 Variables: `STORAGE_PROVIDER=supabase`, and `SUPABASE_PRIVATE_BUCKET` /
  `SUPABASE_STORAGE_BUCKET` only if you used other names.
- ✅ The server refuses to use a public bucket for the files that are sold: if a download fails,
  the log says why.

## 4. The variables, in the hosting service

- 🧑 Create the project on the hosting service from the GitHub repository. On Vercel:
  <https://vercel.com/docs/getting-started-with-vercel/import>. Any Node server or Docker works
  too ([`docs/deploy.md`](deploy.md)).
- 🤖 Make a random secret for the owner to paste: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
  (one for `ORDER_SECRET`, another for `ADMIN_SESSION_SECRET`).
- 🧑 In the project's environment variables (<https://vercel.com/docs/environment-variables>) add:

  | Variable | Value |
  |---|---|
  | `DATA_SOURCE` | `supabase` |
  | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
  | `ORDER_SECRET` | the first random secret |
  | `NEXT_PUBLIC_SITE_URL` | the public address, `https://…` (the hosting one for now) |
  | `ORDER_EXPIRY_HOURS`, `BOOKING_HOLD_HOURS` | only to change the defaults (48 and 12) |

- ✅ After the next deploy, the store opens and a test order appears in `/admin` (step 5 first).
  Every variable is explained in [`.env.example`](../.env.example).

## 5. The admin user

- 🤖 Run `npm run admin:hash` on your computer. It asks for the owner's e-mail and a password
  (the owner types it; 8+ characters) and prints one line: `email:scrypt.…`.
- 🧑 Add `ADMIN_USERS` = that line, and `ADMIN_SESSION_SECRET` = the second random secret.
- ✅ `/admin/login` accepts that e-mail and password. More users: several lines separated by commas.

## 6. Turn the demo off

- 🧑 Add `DEMO_MODE=false`. (Leave `DEMO_ORDERS` unset: example orders belong to demos.)
- ✅ The login screen no longer offers demo credentials, the home page no longer shows the block
  "you are looking at a demo", and the panel starts with no orders. Make a real test order, move
  it to "Paid" and cancel it.

## 7. Payments

By default the store charges by bank transfer or arranging by WhatsApp: fill in the bank details
in `config/commerce.ts`. To take cards, one of these (both redirect to the provider's own page):

- **Mercado Pago** — 🧑 create the application and copy the production access token:
  <https://www.mercadopago.com/developers/en/docs/checkout-pro/overview>. Configure the webhook
  to `https://YOUR-DOMAIN/api/payments/mercadopago/webhook` for payment events and copy its secret:
  <https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks>.
  Variables: `PAYMENT_PROVIDER=mercadopago`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`.
- **Stripe** — 🧑 copy the secret key (<https://docs.stripe.com/keys>) and create a webhook
  endpoint to `https://YOUR-DOMAIN/api/payments/stripe/webhook` for the events
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then copy its
  signing secret (<https://docs.stripe.com/webhooks>). Variables: `PAYMENT_PROVIDER=stripe`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- ✅ **Pay a real, small order from end to end** (with the provider's test mode first, if it has
  one): the order must move to "Paid" on its own. The store never marks an order as paid without
  a signed notification for the exact total.

## 8. E-mail

Without it nothing is e-mailed: no order confirmation, no quote, no download links.

- 🧑 Create an account at Resend, verify the domain you will send from and create an API key:
  <https://resend.com/docs/dashboard/domains/introduction> · <https://resend.com/docs/dashboard/api-keys/introduction>.
  (Any SMTP mailbox works too: `MAIL_PROVIDER=smtp` and `SMTP_URL`.)
- 🧑 Variables: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (`Store <orders@your-domain>`),
  and `ORDER_NOTIFY_EMAIL` = where the owner wants to be told about each order.
- ✅ A test order sends two e-mails: one to the buyer, one to the owner.

## 9. The domain

- 🧑 Buy the domain (or use one you have) and add it to the hosting project, following its
  instructions for the DNS records: <https://vercel.com/docs/domains/working-with-domains/add-a-domain>.
- 🧑 Change `NEXT_PUBLIC_SITE_URL` to the final address (`https://www.your-domain…`) and deploy
  again. Update the webhook addresses of step 7 if they used the old one.
- ✅ The store opens on the domain with the padlock, and an order link in an e-mail points there.

## 10. Open the doors

- 🤖 `npm run doctor` says everything is ready. `npm run check` lists no drafts (products without
  a price) and no EXAMPLE texts.
- 🤖 Legal pages are filled in with what the owner confirmed (terms, privacy, returns).
- 🧑 Buy something yourself, from a phone, and follow it in `/admin` until it is delivered.
- 🧑 Only now: `ALLOW_INDEXING=1`, so search engines can list the store. Then
  [`GETTING-STARTED.md`](../GETTING-STARTED.md) §10–12: search consoles, product feeds, measurement.

## If something does not work

- `npm run doctor` — what is missing, in plain words.
- The server log of the hosting service: the store says clearly what it refuses and why (an
  unsigned webhook, a public bucket, a missing variable at start-up).
- [`docs/adapters.md`](adapters.md) and [`SECURITY.md`](../SECURITY.md) for how each piece works.

What this guide cannot check for you: it was written without real accounts at these providers.
The store's side of each step is tested; the provider's screens are theirs, and they change.
