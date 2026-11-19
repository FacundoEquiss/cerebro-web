-- Cerebro Web — database schema.
-- Works on Supabase AND on any plain PostgreSQL 15+ (the Supabase-only parts are guarded).
--
--   Supabase:  paste this file in the SQL editor, then `db/seed.sql` (optional demo catalogue).
--   Postgres:  psql "$DATABASE_URL" -f db/schema.sql -f db/seed.sql
--
-- THE RULES THIS FILE ENFORCES
--   1. The storefront never touches a table. It READS the views `public_catalog` and
--      `public_categories` (only the columns a shopper may see) and WRITES through functions.
--   2. Row level security is ON for every table. The only policies are READ policies on the
--      three catalogue tables (active products, their variants, categories). The public views
--      run with the rights of whoever queries them (`security_invoker`), so they cannot be used
--      to write, and at the end of this file every other right of the public roles is revoked:
--      with the public key nothing can be inserted, updated or deleted, and no function called.
--   3. `create_order()` looks every price up here. Whatever amount a browser sends is ignored.
--   4. `create_order()` is idempotent (same key → same order) and `record_payment()` credits a
--      payment exactly once and only if the amount paid equals the official total.
--   5. The admin panel also goes through functions (`admin_*`, `set_order_status`, `save_product`…),
--      callable only by the web SERVER. Every status change is written to `order_events`.
--
-- Running it twice is safe.

create table if not exists categories (
  slug        text primary key,
  name        text not null,
  description text not null default '',
  position    int  not null default 0
);

create table if not exists products (
  id               text primary key,
  slug             text not null unique,
  name             text not null,
  description      text not null default '',
  category         text not null references categories (slug),
  price            numeric(12, 2) not null check (price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  images           jsonb not null default '[]',
  -- Declared axes: [{ "id": "size", "name": "Size", "values": [{ "id": "m", "label": "M" }] }]
  options          jsonb not null default '[]',
  -- Stock of a product WITHOUT options. null = made to order.
  stock            int check (stock is null or stock >= 0),
  featured         boolean not null default false,
  active           boolean not null default true,
  min_quantity     int not null default 1 check (min_quantity >= 1),
  attributes       jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create table if not exists variants (
  id         text primary key,
  product_id text not null references products (id) on delete cascade,
  -- One value per option: { "size": "m", "color": "black" }
  options    jsonb not null,
  -- null = made to order.
  stock      int check (stock is null or stock >= 0),
  -- Overrides the product price when set.
  price      numeric(12, 2) check (price is null or price >= 0),
  active     boolean not null default true
);
create index if not exists variants_product_idx on variants (product_id);

create table if not exists orders (
  id               text primary key,
  idempotency_key  text not null unique,
  -- The kanban columns of the admin panel. The allowed moves live in lib/orders/status.ts.
  status           text not null default 'new'
                   check (status in ('new', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled')),
  currency         text not null,
  subtotal         numeric(12, 2) not null,
  shipping_method  text not null,
  shipping_price   numeric(12, 2) not null,
  total            numeric(12, 2) not null,
  payment_provider text not null,
  payment_method   text not null,
  customer         jsonb not null,
  attribution      jsonb not null default '{}',
  -- When the money was confirmed (by a gateway webhook or by hand). null = not paid yet.
  paid_at          timestamptz,
  -- When the `purchase` event was reported to the ad platforms. Set ONCE (claim_purchase_event).
  purchase_sent_at timestamptz,
  cancel_reason    text,
  tracking         text,
  created_at       timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at desc);

-- The timeline of an order: creation, every status change, payments, internal notes.
create table if not exists order_events (
  id          bigint generated always as identity primary key,
  order_id    text not null references orders (id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null check (type in ('created', 'status', 'payment', 'note', 'tracking')),
  from_status text,
  to_status   text,
  actor       text not null default 'system',
  text        text not null default ''
);
create index if not exists order_events_order_idx on order_events (order_id, id);

create table if not exists order_lines (
  order_id      text not null references orders (id) on delete cascade,
  position      int  not null,
  product_id    text not null,
  variant_id    text,
  name          text not null,
  variant_label text not null default '',
  selection     jsonb not null default '{}',
  quantity      int not null check (quantity > 0),
  unit_price    numeric(12, 2) not null,
  image         text,
  -- True when this line took units from the stock. Cancelling returns ONLY those.
  stock_taken   boolean not null default false,
  primary key (order_id, position)
);
alter table order_lines add column if not exists stock_taken boolean not null default false;

create table if not exists payments (
  provider   text not null,
  payment_id text not null,
  order_id   text not null references orders (id),
  amount     numeric(12, 2) not null,
  currency   text not null,
  status     text not null,
  matches    boolean not null,
  created_at timestamptz not null default now(),
  -- The same payment notified twice must not be credited twice.
  primary key (provider, payment_id)
);

alter table categories  enable row level security;
alter table products    enable row level security;
alter table variants    enable row level security;
alter table orders      enable row level security;
alter table order_lines enable row level security;
alter table payments    enable row level security;
alter table order_events enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Public read model: only what a shopper may see.
--
-- The catalogue is public information, so the public roles may READ the active rows of the three
-- catalogue tables — and nothing else. The views are `security_invoker`: they run with the
-- rights of the role that queries them, never with the owner's. A view that ran as its owner
-- would be a back door: PostgreSQL lets simple views be UPDATED, and the update would skip row
-- level security.
-- ---------------------------------------------------------------------------------------------
drop policy if exists public_read on products;
create policy public_read on products for select using (active);
drop policy if exists public_read on variants;
create policy public_read on variants for select
  using (active and exists (select 1 from products p where p.id = variants.product_id and p.active));
drop policy if exists public_read on categories;
create policy public_read on categories for select using (true);

create or replace view public_catalog with (security_invoker = true) as
select
  p.id, p.slug, p.name, p.description, p.category, p.price, p.compare_at_price, p.images, p.options,
  p.stock, p.featured, p.min_quantity, p.attributes, p.created_at,
  coalesce(
    (select jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'stock', v.stock, 'price', v.price) order by v.id)
       from variants v where v.product_id = p.id and v.active),
    '[]'::jsonb
  ) as variants
from products p
where p.active;

create or replace view public_categories with (security_invoker = true) as
select slug, name, description, position from categories;

-- ---------------------------------------------------------------------------------------------
-- order_json: the order as the storefront reads it. No personal data in it.
-- ---------------------------------------------------------------------------------------------
create or replace function iso(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create or replace function order_json(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id,
    'createdAt', iso(o.created_at),
    'paidAt', iso(o.paid_at),
    'tracking', o.tracking,
    'currency', o.currency,
    'subtotal', o.subtotal,
    'shipping', jsonb_build_object('methodId', o.shipping_method, 'price', o.shipping_price),
    'total', o.total,
    'paymentProvider', o.payment_provider,
    'paymentMethod', o.payment_method,
    'status', o.status,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', l.product_id, 'variantId', l.variant_id, 'name', l.name, 'variantLabel', l.variant_label,
        'quantity', l.quantity, 'unitPrice', l.unit_price, 'image', l.image) order by l.position)
      from order_lines l where l.order_id = o.id), '[]'::jsonb)
  )
  from orders o where o.id = p_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_order: THE SERVER SETS THE PRICE.
--
-- p = {
--   "idempotency_key": "…", "currency": "ARS",
--   "lines": [{ "product_id": "…", "variant_id": "…" | null, "selection": { "size": "m" }, "quantity": 2 }],
--   "shipping": { "method": "delivery", "price": 6500, "free_from": 90000 | null },
--   "payment_provider": "manual", "payment_method": "whatsapp",
--   "customer": { … }, "attribution": { … }, "minimum_order": 0, "max_quantity": 20
-- }
-- Any "price" inside a line is never read. Shipping conditions come from the web server's own
-- configuration (this function is not callable with the public key).
-- Errors are raised as  ORDER_ERROR:<code>:<detail>  — the same codes as lib/data/types.ts.
-- ---------------------------------------------------------------------------------------------
create or replace function create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key       text := p ->> 'idempotency_key';
  v_id        text;
  v_line      jsonb;
  v_pos       int := 0;
  v_qty       int;
  v_product   products%rowtype;
  v_variant   variants%rowtype;
  v_has_var   boolean;
  v_selection jsonb;
  v_opt       jsonb;
  v_label     text;
  v_price     numeric(12, 2);
  v_image     text;
  v_subtotal  numeric(12, 2) := 0;
  v_shipping  numeric(12, 2);
  v_max       int := coalesce((p ->> 'max_quantity')::int, 20);
  v_taken     boolean;
begin
  if v_key is null or length(v_key) < 16 then
    raise exception 'ORDER_ERROR:empty:idempotency_key';
  end if;

  -- Same key → same order. A retry never creates a second one.
  select id into v_id from orders where idempotency_key = v_key;
  if found then
    return order_json(v_id);
  end if;

  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'ORDER_ERROR:empty:';
  end if;

  v_id := 'P-' || upper(substr(md5(v_key), 1, 10));

  insert into orders (id, idempotency_key, currency, subtotal, shipping_method, shipping_price, total,
                      payment_provider, payment_method, customer, attribution)
  values (v_id, v_key, p ->> 'currency', 0, p #>> '{shipping,method}', 0, 0,
          p ->> 'payment_provider', p ->> 'payment_method',
          coalesce(p -> 'customer', '{}'::jsonb), coalesce(p -> 'attribution', '{}'::jsonb));
  insert into order_events (order_id, type, to_status, actor) values (v_id, 'created', 'new', 'store');

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_pos := v_pos + 1;
    v_qty := (v_line ->> 'quantity')::int;

    select * into v_product from products where id = v_line ->> 'product_id' and active;
    if not found then
      raise exception 'ORDER_ERROR:unknown_product:%', v_line ->> 'product_id';
    end if;
    if v_qty is null or v_qty < v_product.min_quantity or v_qty > v_max then
      raise exception 'ORDER_ERROR:quantity:%', v_product.id;
    end if;

    v_variant := null;
    v_taken := false;
    v_selection := '{}'::jsonb;
    v_label := '';
    v_price := v_product.price;

    if jsonb_array_length(v_product.options) > 0 then
      select exists (select 1 from variants where product_id = v_product.id and active) into v_has_var;

      if coalesce(v_line ->> 'variant_id', '') <> '' then
        select * into v_variant from variants
          where id = v_line ->> 'variant_id' and product_id = v_product.id and active for update;
        if not found then
          raise exception 'ORDER_ERROR:unknown_variant:%', v_line ->> 'variant_id';
        end if;
        v_selection := v_variant.options;
      else
        -- Options declared: the customer MUST have chosen every one, with a value that exists.
        v_selection := coalesce(v_line -> 'selection', '{}'::jsonb);
        for v_opt in select * from jsonb_array_elements(v_product.options) loop
          if not exists (
            select 1 from jsonb_array_elements(v_opt -> 'values') val
            where val ->> 'id' = v_selection ->> (v_opt ->> 'id')
          ) then
            raise exception 'ORDER_ERROR:selection_required:%', v_product.id;
          end if;
        end loop;
        if v_has_var then
          select * into v_variant from variants
            where product_id = v_product.id and active and options @> v_selection and v_selection @> options for update;
          if not found then
            raise exception 'ORDER_ERROR:unknown_variant:%', v_product.id;
          end if;
        end if;
      end if;

      select coalesce(string_agg(val ->> 'label', ' · ' order by ord), '') into v_label
        from jsonb_array_elements(v_product.options) with ordinality as o (opt, ord),
             jsonb_array_elements(o.opt -> 'values') val
        where val ->> 'id' = v_selection ->> (o.opt ->> 'id');

      if v_variant.id is not null then
        v_price := coalesce(v_variant.price, v_product.price);
        if v_variant.stock is not null then
          if v_variant.stock < v_qty then
            raise exception 'ORDER_ERROR:out_of_stock:%', v_product.id;
          end if;
          update variants set stock = stock - v_qty where id = v_variant.id;
          v_taken := true;
        end if;
      end if;
    else
      if v_product.stock is not null then
        -- Re-read with a lock: two buyers must not take the last unit.
        select stock into v_product.stock from products where id = v_product.id for update;
        if v_product.stock < v_qty then
          raise exception 'ORDER_ERROR:out_of_stock:%', v_product.id;
        end if;
        update products set stock = stock - v_qty where id = v_product.id;
        v_taken := true;
      end if;
    end if;

    select img ->> 'src' into v_image
      from jsonb_array_elements(v_product.images) with ordinality as i (img, ord)
      order by (case when img ? 'option' and v_selection @> (img -> 'option') then 0 else 1 end), ord
      limit 1;

    insert into order_lines (order_id, position, product_id, variant_id, name, variant_label, selection, quantity, unit_price, image, stock_taken)
    values (v_id, v_pos, v_product.id, v_variant.id, v_product.name, v_label, v_selection, v_qty, v_price, v_image, v_taken);

    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  if v_subtotal < coalesce((p ->> 'minimum_order')::numeric, 0) then
    raise exception 'ORDER_ERROR:minimum_order:%', p ->> 'minimum_order';
  end if;

  v_shipping := coalesce((p #>> '{shipping,price}')::numeric, 0);
  if (p #>> '{shipping,free_from}') is not null and v_subtotal >= (p #>> '{shipping,free_from}')::numeric then
    v_shipping := 0;
  end if;

  update orders set subtotal = v_subtotal, shipping_price = v_shipping, total = v_subtotal + v_shipping where id = v_id;
  return order_json(v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- record_payment: credit ONCE, and only if what was paid equals the official total.
-- Returns { "first_time": bool, "amount_matches": bool | null, "order_status": text }.
-- Money that arrives for a CANCELLED order is never credited: it is written to the timeline so
-- the owner can review or refund it, and the caller is told through "order_status".
-- ---------------------------------------------------------------------------------------------
create or replace function record_payment(
  p_provider text, p_payment_id text, p_order_id text, p_amount numeric, p_currency text, p_status text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_matches boolean;
  v_rows    int;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('first_time', false, 'amount_matches', null);
  end if;
  v_matches := (p_amount = v_order.total and upper(p_currency) = upper(v_order.currency));

  insert into payments (provider, payment_id, order_id, amount, currency, status, matches)
  values (p_provider, p_payment_id, p_order_id, p_amount, upper(p_currency), p_status, v_matches)
  on conflict (provider, payment_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Already processed. A pending payment may be approved later: allow that single transition.
    update payments set status = p_status
      where provider = p_provider and payment_id = p_payment_id and status <> 'approved' and p_status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('first_time', false, 'amount_matches', v_matches, 'order_status', v_order.status);
    end if;
  end if;

  if p_status = 'approved' and v_order.status = 'cancelled' then
    insert into order_events (order_id, type, from_status, to_status, actor, text)
    values (p_order_id, 'payment', 'cancelled', null, p_provider, p_payment_id);
  end if;

  if p_status = 'approved' and v_matches and v_order.status = 'new' then
    update orders set status = 'paid', paid_at = now() where id = p_order_id;
    insert into order_events (order_id, type, from_status, to_status, actor, text)
    values (p_order_id, 'payment', 'new', 'paid', p_provider, p_payment_id);
  end if;
  return jsonb_build_object('first_time', p_status = 'approved', 'amount_matches', v_matches, 'order_status', v_order.status);
end;
$$;

create or replace function get_order(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select order_json(p_id);
$$;

-- ---------------------------------------------------------------------------------------------
-- ADMIN PANEL. Everything below is for the web server only (never the public key).
-- ---------------------------------------------------------------------------------------------

-- The order as the admin panel reads it: the public order + customer, attribution and timeline.
create or replace function admin_order_json(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select order_json(o.id) || jsonb_build_object(
    'customer', o.customer,
    'attribution', o.attribution,
    'cancelReason', o.cancel_reason,
    'purchaseSentAt', iso(o.purchase_sent_at),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', iso(e.at), 'type', e.type, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor, 'text', e.text) order by e.id)
      from order_events e where e.order_id = o.id), '[]'::jsonb)
  )
  from orders o where o.id = p_id;
$$;

create or replace function admin_order(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select admin_order_json(p_id);
$$;

-- Newest first. The panel reads the latest p_limit orders (500 by default).
create or replace function admin_orders(p_limit int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(admin_order_json(o.id) order by o.created_at desc, o.id), '[]'::jsonb)
  from (select id, created_at from orders order by created_at desc, id limit greatest(coalesce(p_limit, 500), 1)) o;
$$;

-- Returns to the shelf the units an order really took (order_lines.stock_taken), once.
create or replace function release_order_stock(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line order_lines%rowtype;
begin
  for v_line in select * from order_lines where order_id = p_id and stock_taken for update loop
    if v_line.variant_id is not null then
      update variants set stock = stock + v_line.quantity where id = v_line.variant_id and stock is not null;
    else
      update products set stock = stock + v_line.quantity where id = v_line.product_id and stock is not null;
    end if;
  end loop;
  update order_lines set stock_taken = false where order_id = p_id and stock_taken;
end;
$$;

-- UNPAID ORDERS DO NOT HOLD STOCK FOREVER. Orders still in `new` after p_hours are cancelled with
-- p_reason and their stock goes back. Returns how many were cancelled. Safe to call at any time
-- and from several places at once (the web server calls it lazily and from a cron route).
create or replace function expire_orders(p_hours numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    text;
  v_count int := 0;
begin
  if p_hours is null or p_hours <= 0 then
    return to_jsonb(0);
  end if;
  for v_id in
    select id from orders
    where status = 'new' and paid_at is null and created_at < now() - make_interval(secs => (p_hours * 3600)::double precision)
    for update skip locked
  loop
    update orders set status = 'cancelled', cancel_reason = p_reason where id = v_id;
    perform release_order_stock(v_id);
    insert into order_events (order_id, type, from_status, to_status, actor, text)
    values (v_id, 'status', 'new', 'cancelled', 'system', coalesce(p_reason, ''));
    v_count := v_count + 1;
  end loop;
  return to_jsonb(v_count);
end;
$$;

-- Moves an order from p_from to p_to. The caller (lib/admin/orders.ts) already checked that the
-- move is allowed; p_from makes it safe when two people act at once: if someone else moved the
-- order first this raises ORDER_CONFLICT and nothing changes. Cancelling returns the stock.
create or replace function set_order_status(p_id text, p_from text, p_to text, p_actor text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_line  order_lines%rowtype;
begin
  select * into v_order from orders where id = p_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_id;
  end if;
  if v_order.status <> p_from then
    raise exception 'ORDER_CONFLICT:%', v_order.status;
  end if;

  update orders set
    status = p_to,
    paid_at = case when p_to = 'paid' then coalesce(paid_at, now()) else paid_at end,
    cancel_reason = case when p_to = 'cancelled' then nullif(trim(coalesce(p_reason, '')), '') else cancel_reason end
  where id = p_id;

  if p_to = 'cancelled' then
    perform release_order_stock(p_id);
  end if;

  insert into order_events (order_id, type, from_status, to_status, actor, text)
  values (p_id, 'status', p_from, p_to, coalesce(p_actor, 'admin'), coalesce(p_reason, ''));
  return admin_order_json(p_id);
end;
$$;

create or replace function add_order_note(p_id text, p_text text, p_actor text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from orders where id = p_id) then
    raise exception 'ORDER_NOT_FOUND:%', p_id;
  end if;
  insert into order_events (order_id, type, actor, text) values (p_id, 'note', coalesce(p_actor, 'admin'), p_text);
  return admin_order_json(p_id);
end;
$$;

create or replace function set_order_tracking(p_id text, p_tracking text, p_actor text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update orders set tracking = nullif(trim(coalesce(p_tracking, '')), '') where id = p_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_id;
  end if;
  insert into order_events (order_id, type, actor, text)
  values (p_id, 'tracking', coalesce(p_actor, 'admin'), coalesce(p_tracking, ''));
  return admin_order_json(p_id);
end;
$$;

-- THE PURCHASE IS REPORTED ONCE. Returns true only to the first caller; everyone after gets false.
create or replace function claim_purchase_event(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update orders set purchase_sent_at = now() where id = p_id and purchase_sent_at is null;
  return to_jsonb(found);
end;
$$;

-- Every product, paused ones included, in the shape of `public_catalog` plus `active`.
create or replace function admin_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description, 'category', p.category,
    'price', p.price, 'compare_at_price', p.compare_at_price, 'images', p.images, 'options', p.options,
    'stock', p.stock, 'featured', p.featured, 'active', p.active, 'min_quantity', p.min_quantity,
    'attributes', p.attributes, 'created_at', p.created_at,
    'variants', coalesce(
      (select jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'stock', v.stock, 'price', v.price) order by v.id)
         from variants v where v.product_id = p.id and v.active), '[]'::jsonb)
  ) order by p.created_at desc, p.id), '[]'::jsonb)
  from products p;
$$;

-- Creates or updates a product and REPLACES its variants with the ones given.
-- p = the product as lib/data/types.ts describes it (camelCase keys).
create or replace function save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p ->> 'id';
  v    jsonb;
begin
  if coalesce(v_id, '') = '' or coalesce(p ->> 'slug', '') = '' or coalesce(p ->> 'name', '') = '' then
    raise exception 'PRODUCT_ERROR:required';
  end if;
  if exists (select 1 from products where slug = p ->> 'slug' and id <> v_id) then
    raise exception 'PRODUCT_ERROR:slug_taken';
  end if;
  if not exists (select 1 from categories where slug = p ->> 'category') then
    raise exception 'PRODUCT_ERROR:category';
  end if;

  insert into products (id, slug, name, description, category, price, compare_at_price, images, options,
                        stock, featured, active, min_quantity, attributes)
  values (v_id, p ->> 'slug', p ->> 'name', coalesce(p ->> 'description', ''), p ->> 'category',
          (p ->> 'price')::numeric, (p ->> 'compareAtPrice')::numeric,
          coalesce(p -> 'images', '[]'::jsonb), coalesce(p -> 'options', '[]'::jsonb),
          (p ->> 'stock')::int, coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'active')::boolean, true),
          coalesce((p ->> 'minQuantity')::int, 1), coalesce(p -> 'attributes', '{}'::jsonb))
  on conflict (id) do update set
    slug = excluded.slug, name = excluded.name, description = excluded.description, category = excluded.category,
    price = excluded.price, compare_at_price = excluded.compare_at_price, images = excluded.images,
    options = excluded.options, stock = excluded.stock, featured = excluded.featured, active = excluded.active,
    min_quantity = excluded.min_quantity, attributes = excluded.attributes;

  delete from variants where product_id = v_id
    and id not in (select x ->> 'id' from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) x);
  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    insert into variants (id, product_id, options, stock, price)
    values (v ->> 'id', v_id, v -> 'options', (v ->> 'stock')::int, (v ->> 'price')::numeric)
    on conflict (id) do update set options = excluded.options, stock = excluded.stock, price = excluded.price, active = true;
  end loop;

  return (select x from jsonb_array_elements(admin_catalog()) x where x ->> 'id' = v_id);
end;
$$;

-- Inline stock edit. p_variant_id null = the product's own stock. p_stock null = made to order.
create or replace function set_stock(p_product_id text, p_variant_id text, p_stock int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_variant_id is not null then
    update variants set stock = p_stock where id = p_variant_id and product_id = p_product_id;
  else
    update products set stock = p_stock where id = p_product_id;
  end if;
  return to_jsonb(found);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions. CLOSE EVERYTHING FIRST, then open the minimum.
--
-- On Supabase, new tables, views and functions of the `public` schema are born with ALL rights
-- for the public roles (`anon`, `authenticated`). So this block first REVOKES every right those
-- roles (and the PUBLIC pseudo-role) have on the objects of this schema, and only then grants:
--   · anon / authenticated: SELECT on the two views and on the three catalogue tables behind
--     them (row level security shows them the active rows only). Nothing else — no insert,
--     update or delete anywhere, no function.
--   · service_role (the key that only the web SERVER holds): EXECUTE on the functions.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  f text;
  r text;
  o text;
  tables text[] := array['categories', 'products', 'variants', 'orders', 'order_lines', 'payments', 'order_events',
                         'public_catalog', 'public_categories'];
  fns text[] := array[
    'create_order(jsonb)', 'record_payment(text, text, text, numeric, text, text)', 'get_order(text)',
    'order_json(text)', 'admin_order_json(text)', 'admin_order(text)', 'admin_orders(int)',
    'set_order_status(text, text, text, text, text)', 'add_order_note(text, text, text)',
    'set_order_tracking(text, text, text)', 'claim_purchase_event(text)', 'admin_catalog()',
    'save_product(jsonb)', 'set_stock(text, text, int)', 'release_order_stock(text)',
    'expire_orders(numeric, text)', 'iso(timestamptz)'
  ];
  server_fns text[] := array[
    'create_order(jsonb)', 'record_payment(text, text, text, numeric, text, text)', 'get_order(text)',
    'admin_order(text)', 'admin_orders(int)', 'set_order_status(text, text, text, text, text)',
    'add_order_note(text, text, text)', 'set_order_tracking(text, text, text)', 'claim_purchase_event(text)',
    'admin_catalog()', 'save_product(jsonb)', 'set_stock(text, text, int)', 'expire_orders(numeric, text)'
  ];
begin
  foreach o in array tables loop
    execute format('revoke all on %I from public', o);
  end loop;
  execute 'revoke all on sequence order_events_id_seq from public';
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
  end loop;

  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach o in array tables loop
        execute format('revoke all on %I from %I', o, r);
      end loop;
      execute format('revoke all on sequence order_events_id_seq from %I', r);
      foreach f in array fns loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
      execute format('grant select on public_catalog, public_categories, products, variants, categories to %I', r);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array server_fns loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end;
$$;
