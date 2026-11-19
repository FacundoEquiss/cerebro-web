# Roadmap

Where Cerebro Web is going. Nothing here is promised by a date; the order is the priority.
Want one of these sooner? Open a proposal, or a pull request.

## Next (0.2)

- **Editable settings in the panel** — shipping methods, lead times and bank details from
  `/admin/settings` instead of `config/commerce.ts` (0.1 is read-only).
- **Categories in the panel** — create, rename and order categories (0.1 reads them from the data
  adapter).
- **Realtime reception with Supabase** — push new orders to the kanban instead of polling, when
  the data adapter is `supabase` (polling stays as the universal fallback).
- **S3-compatible storage adapter** for product photos.
- **Shared rate limiting** — a store behind `lib/rate-limit.ts` (Redis or a database table) for
  serverless hosting.
- **Coupons and promotions**, calculated on the server.
- **Shipping rates by zone or weight**, and a carrier adapter interface.
- **English translation of the brain** (`cerebro/datos.json` is Spanish only today).

## Future modules, in this same repository

The admin panel is the first piece of a small CRM. Planned as optional modules that talk to the
same adapters:

- **Customers with conversations** — a customer record with its orders, notes and the history of
  messages exchanged.
- **Quotes** — build a quote, send it as a link, turn it into an order when it is accepted.
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
