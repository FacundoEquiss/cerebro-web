-- Cerebro Web — migration 0003: draft products (0.2.0 → 0.3.0).
--
-- A product whose price is not known yet can be loaded as a DRAFT: it is not for sale — hidden
-- from the public catalogue, refused by create_order() — and only the admin panel shows it.
--
-- HOW TO APPLY IT (ask the owner first: it changes a real database)
--   1. Make a backup.
--   2. Run this file (it adds one column and narrows what the public key can read).
--   3. Run db/schema.sql again: it replaces the functions (create_order, save_product…).
--      Running db/schema.sql alone gives the same result. Safe to run twice. Nothing is deleted:
--      every existing product stays as it is (not a draft).

alter table products add column if not exists draft boolean not null default false;

drop policy if exists public_read on products;
create policy public_read on products for select using (active and not draft);
drop policy if exists public_read on variants;
create policy public_read on variants for select
  using (active and exists (select 1 from products p where p.id = variants.product_id and p.active and not p.draft));

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
where p.active and not p.draft;
