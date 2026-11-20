# Roadmap

Where Cerebro Web is going. Nothing here is promised by a date; the order is the priority.
Want one of these sooner? Open a proposal, or a pull request.

## Done in 0.2

- **Product types**: physical, digital (private file, signed download), services by appointment
  (slots, capacity, Agenda) and quote on request (enquiry → quote → accepted order).
- **Sale by unit, weight or measure**, with decimal quantities validated on the server.
- **Mixed carts**: shipping only when something is shipped.
- **Starting catalogues per line of business** (`npm run preset`).

## Done in 0.3

- Tests that survive any catalogue (their own fixtures), `npm run check:catalog`, `npm run doctor`.
- The "from zero to selling" guide; the one-command creator (to be published to npm).
- Events with fixed dates and limited places; drafts for products without a price.

## Next (0.4)

- **Editable settings in the panel** — shipping methods, lead times, opening hours and bank
  details from `/admin/settings` instead of `config/commerce.ts` (today it is read-only).
- **Categories in the panel** — create, rename and order categories (today they come from the
  data adapter).
- **Realtime reception with Supabase** — push new orders to the kanban instead of polling, when
  the data adapter is `supabase` (polling stays as the universal fallback).
- **S3-compatible storage adapter**, for product photos and for the private files of digital
  products.
- **Shared rate limiting** — a store behind `lib/rate-limit.ts` (Redis or a database table) for
  serverless hosting.
- **Coupons and promotions**, calculated on the server.
- **Shipping rates by zone or weight**, and a carrier adapter interface.
- **English translation of the brain** (`cerebro/datos.json` is Spanish only today).

## By line of business

What the table of the README lists as "on the roadmap". None of these is built; the order is not
a promise.

- **Subscriptions** — recurring billing through the payment adapters, with sign-up, renewal,
  cancellation and the notices each one needs.
- **Wholesale prices by quantity** — tiered prices per product (1–9, 10–49, 50+…) calculated on
  the server, then price lists per customer.
- **Product customiser** — the customer uploads or composes a design on a product (text, image,
  position) and the order carries the artwork.
- **Marketplace** — several sellers, each with their products, orders and payouts. Being
  explored: it changes the data model (vendors, commissions, settlements, permissions).
- **Multi-currency** — prices in more than one currency, with the rate fixed on the server when
  the order is created.
- **Events**: a waiting list, tickets with a code to check at the door, a price or a number of
  places per date.
- **Services**: reminders by e-mail or message, rescheduling and cancelling by the customer,
  one calendar per member of staff or per room, calendar sync, deposits, appointments created by
  hand in the panel.
- **Digital products**: several files per product, a course player (streaming), licence keys,
  download limits.
- **Sale by weight**: charging or refunding the difference of the real weight.
- **Food**: delivery zones by distance, extras and modifiers per dish, an open/closed switch
  that follows the opening hours.
- **Quotes**: building a quote from scratch in the panel (several products), a PDF, an expiry
  date, a deposit.

## Future modules, in this same repository

The admin panel is the first piece of a small CRM. Planned as optional modules that talk to the
same adapters:

- **Customers with conversations** — a customer record with its orders, notes and the history of
  messages exchanged.
- **Quotes, next step** — 0.2 answers an enquiry about one product; the module adds quotes built
  by the owner for any customer, with several lines and a PDF.
- **WhatsApp inbox** — receive and answer WhatsApp messages inside the panel through the official
  business API, linked to the customer and the order.
- **Attribution of WhatsApp sales to ads** — connect an order closed by message with the ad that
  started the conversation, and report that purchase to the ad platform.

## Later

- Customer accounts (order history, saved addresses) — optional, the store works without them.
- Product reviews with verified purchases (and only then, rating markup).
- More payment adapters, contributed by the community.
- More languages for the UI dictionaries.
- Roles in the panel (owner, staff) and an audit log beyond the order timeline.
- Stock alerts and a low-stock report.
- Abandoned-checkout reminders, with consent.

## Not planned

- A page builder or a theme marketplace: the agent edits the code, guided by the brain.
- Multi-tenant hosting: one repository is one business.
