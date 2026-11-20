-- Cerebro Web — migration 0002: product types (0.1.0 → 0.2.0).
--
-- Adds: the type of a product (physical, digital, service, quote), sale by unit, weight or
-- measure (decimal quantities and stock), appointments, quotes, and the private file of a
-- digital product.
--
-- HOW TO APPLY IT (ask the owner first: it changes a real database)
--   1. Make a backup.
--   2. Run this file. It is self-contained for the DATA: tables, columns and the public catalogue
--      view (which it has to drop to change a column type, and creates again at the end).
--   3. Run db/schema.sql again: it replaces the FUNCTIONS and the permissions with the 0.2.0 ones.
--      Until you do, the store keeps working with the 0.1.0 functions.
--      (schema.sql alone also does everything — it contains these same statements — this file
--      exists for those who keep a record of migrations.)
--
-- Nothing is deleted. Existing products become `physical`, sold by the piece ('u', step 1);
-- existing orders keep their lines. Safe to run twice.

create table if not exists product_files (
  product_id text primary key references products (id) on delete cascade,
  file       text not null
);
alter table product_files enable row level security;

-- ---------------------------------------------------------------------------------------------
-- UPGRADE 0.1.0 → 0.2.0 (product types, sale by weight, appointments, quotes).
-- Every statement is safe on a database that already has it.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  -- Quantities and stock become decimals (0.25 kg). A column used by a view cannot change its
  -- type, so the view is dropped first; it is created again right below.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'products' and column_name = 'min_quantity' and data_type = 'integer') then
    drop view if exists public_catalog;
    alter table products alter column min_quantity type numeric(12, 3);
    alter table products alter column stock type numeric(12, 3);
    alter table variants alter column stock type numeric(12, 3);
    alter table order_lines alter column quantity type numeric(12, 3);
    alter table products drop constraint if exists products_min_quantity_check;
    alter table products add constraint products_min_quantity_check check (min_quantity > 0);
  end if;
end;
$$;
drop function if exists set_stock(text, text, int);

alter table products add column if not exists type text not null default 'physical' check (type in ('physical', 'digital', 'service', 'quote'));
alter table products add column if not exists unit text not null default 'u';
alter table products add column if not exists step numeric(12, 3) not null default 1 check (step > 0);
alter table products add column if not exists max_quantity numeric(12, 3) check (max_quantity is null or max_quantity > 0);
alter table products add column if not exists service jsonb;
alter table products add column if not exists digital jsonb;

alter table orders add column if not exists is_quote boolean not null default false;
alter table orders add column if not exists quote_sent_at timestamptz;
alter table orders add column if not exists accepted_at timestamptz;
alter table orders add column if not exists hold_until timestamptz;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('quote', 'new', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'));
alter table order_events drop constraint if exists order_events_type_check;
alter table order_events add constraint order_events_type_check
  check (type in ('created', 'status', 'payment', 'note', 'tracking', 'quote'));

alter table order_lines add column if not exists type text not null default 'physical';
alter table order_lines add column if not exists unit text not null default 'u';
alter table order_lines add column if not exists slot_start timestamptz;
alter table order_lines add column if not exists slot_end timestamptz;
alter table order_lines add column if not exists note text;
create index if not exists order_lines_slot_idx on order_lines (product_id, slot_start) where slot_start is not null;

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


-- The public catalogue view, with the new columns. (It was dropped above when a column it used
-- changed its type.) Same definition as db/schema.sql.
create or replace view public_catalog with (security_invoker = true) as
select
  p.id, p.slug, p.name, p.description, p.category, p.price, p.compare_at_price, p.images, p.options,
  p.stock, p.featured, p.min_quantity, p.attributes, p.created_at,
  coalesce(
    (select jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'stock', v.stock, 'price', v.price) order by v.id)
       from variants v where v.product_id = p.id and v.active),
    '[]'::jsonb
  ) as variants,
  p.type, p.unit, p.step, p.max_quantity, p.service, p.digital
from products p
where p.active;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public_catalog, product_files from %I', r);
      execute format('grant select on public_catalog to %I', r);
    end if;
  end loop;
  revoke all on public_catalog, product_files from public;
end;
$$;
