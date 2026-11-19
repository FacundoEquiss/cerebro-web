# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Added

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

[Unreleased]: https://github.com/FacundoEquiss/cerebro-web/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FacundoEquiss/cerebro-web/releases/tag/v0.1.0
