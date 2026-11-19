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

Columns: **New → Paid → Preparing → Ready / Shipped → Delivered**. Cancelled orders are folded
apart. Each card shows the number, customer, total, items, payment method and status, delivery
method and how long ago it came in.

Moving a card:

- **Computer**: drag it with the mouse. Valid columns light up; the others dim.
- **Phone**: the «Move to…» menu on the card (a native select). There is no touch dragging on
  purpose: it fights the scroll. Columns scroll sideways.
- **Keyboard**: focus a card, `Shift + →` / `Shift + ←`; `Enter` opens it. The menu works too.

The allowed moves are one table, `lib/orders/status.ts`: an order must be paid before it is
prepared, a step can be undone before delivery, a paid order never goes back to «New», and
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

## Where changes are saved

| Data adapter | The panel |
|---|---|
| `supabase`, `postgres` | Saves for real |
| `json`, local | Saves to files under `DATA_DIR` |
| `json`, production | Read-only, with example orders and the notice "demo mode: changes are not saved; connect a database" |
