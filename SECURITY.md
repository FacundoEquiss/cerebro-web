# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub Security Advisories:

https://github.com/FacundoEquiss/cerebro-web/security/advisories/new

Include what you found, how to reproduce it and what an attacker could do with it. You will get an
answer within 7 days. Please give us a reasonable time to fix it before making it public; you will
be credited in the advisory unless you prefer otherwise.

## Supported versions

The latest release on `main`. This project is pre-1.0: fixes are not back-ported.

## What matters most here

This is a store that takes orders and money. These are the properties the project defends, and
the places to look first:

| Property | Where |
|---|---|
| The server sets every price; a browser cannot choose what it pays | `lib/orders/pricing.ts`, `create_order()` in `db/schema.sql` |
| An order is created once per attempt | `lib/orders/idempotency.ts`, the `idempotency_key` unique column |
| A payment is credited once, and only for the official amount | `lib/payments/credit.ts`, `record_payment()` |
| Webhooks are verified before anything else | `lib/payments/mercadopago.ts`, `lib/payments/stripe.ts` |
| Order links cannot be forged or edited | `lib/orders/receipt.ts` |
| The admin panel needs a valid, signed session on every page and every route | `proxy.ts`, `lib/admin/auth.ts`, `lib/admin/session.ts` |
| No fixed key can sign a session that writes, or an order receipt: secrets are mandatory in production and random per machine elsewhere | `lib/env.ts`, `instrumentation.ts` |
| Passwords are stored as scrypt hashes; failed logins are limited per e-mail and per address | `lib/admin/password.ts`, `lib/admin/login.ts` |
| The caller's address is read only from a trusted source | `clientIp` in `lib/rate-limit.ts` (`TRUSTED_PROXY_HEADER`) |
| The public database key can read the catalogue and write nothing, even with permissive default grants | the permissions block and the `security_invoker` views of `db/schema.sql`, `tests/sql.test.ts` |
| Unpaid orders do not hold stock forever; money for a cancelled order is flagged, never credited | `lib/orders/expiry.ts`, `expire_orders()`, `lib/payments/credit.ts` |
| Uploads are checked by content, not by name | `lib/storage/index.ts`, `app/api/admin/upload/route.ts` |
| A digital file has no public address: it is served only through a signed link that expires, and only while the stored order is paid | `lib/orders/download.ts`, `app/api/downloads/[id]/[line]/route.ts`, the private side of `lib/storage/index.ts`, the `product_files` table |
| A slot cannot be oversold by simultaneous orders, and the browser cannot invent one | `lib/booking/slots.ts` (`resolveSlot`), the capacity check of `create_order()` |
| A quote cannot be accepted before it is sent, nor for another total | `accept_quote()` in `db/schema.sql`, `acceptQuote` in `lib/data/json.ts`, `app/api/quotes/accept/route.ts` |
| Quantities are validated on the server (minimum, step, maximum) and totals are rounded there | `validQuantity` in `lib/data/availability.ts`, `lib/orders/pricing.ts`, `create_order()` |
| Secrets never reach the browser | `lib/env.ts` (server) vs `lib/public-env.ts` (public) |

## Known limits (by design, documented)

- The in-memory rate limiter counts per server process. On serverless hosting put a shared store
  behind `lib/rate-limit.ts`.
- With `DATA_SOURCE=json` nothing is stored in production. It is a demo mode: a payment gateway
  is refused with it in production.
- The demo admin user (`DEMO_MODE`) has a public password and its sessions are signed with a
  public key. That key can only ever produce a **read-only** session; switch demo mode off on a
  real store.
- Without any proxy in front of the server, no header can tell a visitor's real address: set
  `TRUSTED_PROXY_HEADER=none`. The per-e-mail limits still apply.
