**English** · [Español](admin.es.md)

# The admin panel

`/admin` is the daily tool of the business: orders come in here, get paid, prepared, shipped and
delivered. It works on a phone and on a computer.

| Route | Screen |
|---|---|
| `/admin/login` | Sign-in |
| `/admin` | **Orders kanban** (the main screen) |
| `/admin/summary` | Sales: today / 7 days / 30 days, chart, best sellers |
| `/admin/products`, `/admin/products/new`, `/admin/products/<id>` | Product list with inline stock; create / edit |
| `/admin/customers` | Customers, built from the orders |
| `/admin/settings` | Read-only: active adapters and what is missing |
| `/admin/orders/<id>/print` (`?doc=label`) | Printable packing slip / shipping label |

## Access

There is no external identity provider. Users live in the `ADMIN_USERS` environment variable as
`email:hash` pairs, where the hash is **scrypt** (`node:crypto`).

```bash
npm run admin:hash
# Admin e-mail: you@example.com
# Password (8+ characters): ********
# → you@example.com:scrypt.<salt>.<hash>      ← put this in ADMIN_USERS
```

- The session is a **signed cookie** (HMAC-SHA256 with `ADMIN_SESSION_SECRET`): `httpOnly`,
  `SameSite=Lax`, `Secure` on https / production, 12 hours. The secret is mandatory in
  production; there is no built-in key that can sign a session with write access.
- Failed sign-ins are limited to 5 per e-mail (from any address) and 20 per address every 15
  minutes. The address comes from a trusted source only (`TRUSTED_PROXY_HEADER`).
- `proxy.ts` redirects `/admin/*` to the login and answers 401 on `/api/admin/*` without a valid
  cookie — **and every page and every route checks the session again by itself**.
- Writes also require the store's own origin and a real admin.
- The whole panel is `noindex` (meta tag and `X-Robots-Tag`) and blocked in `robots.txt`.

**Demo mode** (`DEMO_MODE=true`, or automatically while the store is an unconfigured demo): the
login screen shows a read-only user (`demo@example.com` / `demo`). It can open every screen and
change nothing — the server refuses its writes with 403. Set `DEMO_MODE=false` on a real store.

## The kanban

Columns: **Enquiries → New → Paid → Preparing → Ready / Shipped → Delivered**. Cancelled orders are
folded apart. Each card shows the number, customer, total, items, payment method and status,
delivery method (only when something is shipped), the **appointment** of a service and how long
ago it came in.

**Enquiries** is the column of the products without a public price: a card there is not an order
yet. It cannot be dragged to another column — it becomes «New» on its own when the customer
accepts the quote — and it can only be cancelled. See [Quotes](#quotes).

Moving a card:

- **Computer**: drag it with the mouse. Valid columns light up; the others dim.
- **Phone**: the «Move to…» menu on the card (a native select). There is no touch dragging on
  purpose: it fights the scroll. Columns scroll sideways.
- **Keyboard**: focus a card, `Shift + →` / `Shift + ←`; `Enter` opens it. The menu works too.

The allowed moves are one table, `lib/orders/status.ts`: an order must be paid before it is
prepared, a step can be undone before delivery, a paid order never goes back to «New», an order
with nothing to ship (a service, a download) — and only such an order — may go from «Paid»
straight to «Delivered», and
«Cancelled» is final (it needs a reason and returns the stock). The server checks every move and
writes it to the order's **history** with who did it and when. If two people act at once, the
second gets "someone else already changed this order" and a fresh list.

Filters: text (number, customer, e-mail, phone), payment method and date.

**Unpaid orders expire.** An order still in «New» after `ORDER_EXPIRY_HOURS` (48 by default)
moves to «Cancelled» with the reason "expired" and its stock goes back. If money arrives later
for a cancelled order, it is **not** credited: the card shows «Payment received: review», the
timeline records it and the owner gets an e-mail to refund it or arrange it with the customer.

## Live reception

The board asks the server for changes every 15 seconds (`GET /api/admin/orders?v=<version>`; when
nothing changed the answer is a few bytes). It works with every data adapter. When a new order
arrives:

- its card appears in «New», highlighted;
- the browser tab shows a counter: `(2) Orders`;
- a short sound plays, if you switched it on (the speaker button);
- a browser notification is shown, if you allowed it (the bell button) and the tab is in the
  background;
- the owner gets an e-mail (`ORDER_NOTIFY_EMAIL` + a mail adapter).

## Order detail

A side panel on a computer, a sheet from the bottom on a phone. Items with their variant,
customer and contact links, delivery and address, payment, timeline, internal notes, and the
actions: confirm the payment by hand (manual payments), move to the next status, cancel with a
reason, save and copy the tracking code, print the packing slip or the label, and message the
customer on WhatsApp with a text written for the current status.

When an order becomes **Paid** — by hand here or by a gateway webhook — the purchase is reported
to the Conversions API **once**: the adapter records that it was sent and the order id is the
`event_id`.

## Quotes

When a customer asks for a quote, the enquiry appears in **Enquiries** with what they wrote.
Open it and you get the quote editor:

1. Type a **unit price** for each line and the **shipping**. The total updates as you type (the
   official one is calculated by the server when you save).
2. **Save** keeps the prices without telling the customer. **Save and send** also marks the quote
   as sent and, **if a mail provider is set up**, e-mails the customer a signed link. The panel
   says whether the e-mail really went out. Either way the editor then shows that link, with
   **Copy link** and **Send by WhatsApp** (a message to the customer's phone, already written),
   so the quote can always be delivered.
3. The customer opens the link, sees the quote and accepts it, choosing how to pay — and giving
   the delivery address when the quote charges shipping. The card moves
   to «New» and from there it is an order like any other: confirm the payment, prepare, deliver.

Until it is sent the customer can neither accept nor pay. If you change a price after sending,
the quote is **no longer sent**: send it again. The customer can only accept the exact total that
was last sent. Every save and every send is written to the order's history. An enquiry never
expires on its own; cancel the ones that lead nowhere.

## Agenda

`/admin/agenda` shows every reserved appointment of the `service` products, in the time zone of
the store (`commerce.booking.timeZone`):

- **Week**: seven columns on a computer, a list of days on a phone. Each day says how many seats
  are still free.
- **Day**: the appointments of one day. Tap a day's name to open it.
- Each appointment shows the time, the service, the customer, the seats, whether it is paid and
  the order number; tapping it opens the order.

An appointment is a line of an order: cancelling the order frees the slot, and an unpaid order
stops holding it when its hold lapses (`booking.holdHours`, 12 by default) — the Agenda stops
showing it at once. It is one calendar per service, not per member of staff. The Agenda needs an
adapter that stores orders; in the read-only demo it shows example bookings. Opening hours, closed days and how far ahead
the calendar opens are set in `config/commerce.ts` (see [`product-types.md`](product-types.md)).
Not built yet: creating an appointment by hand from the panel, moving one, reminders.

## Products of every type

A product marked **Draft** (the price is still missing) shows **Price missing** in the list and is
not in the store until the price is typed and the box unticked. A service with dates in **Fixed
dates** is an event: it is sold by sign-up to those dates, and its sign-ups are in the Agenda.

The product editor has a **Type and how it is sold** block: physical (unit of measure, step,
minimum, maximum), digital (the private file and the name the customer sees), service (duration
and seats per slot) and quote (no public price). The details are in
[`product-types.md`](product-types.md).

## Where changes are saved

| Data adapter | The panel |
|---|---|
| `supabase`, `postgres` | Saves for real |
| `json`, local | Saves to files under `DATA_DIR` |
| `json`, production | Read-only, with example orders and the notice "demo mode: changes are not saved; connect a database" |
