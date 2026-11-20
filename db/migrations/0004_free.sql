-- Cerebro Web — migration 0004: free products (0.3.0 → 0.3.1).
--
-- Price 0 on something for sale is refused as an empty field. A product that is FREE ON PURPOSE
-- (a free download, a sample, an open class) says so: `products.free`.
--
-- HOW TO APPLY IT (ask the owner first: it changes a real database)
--   1. Make a backup.
--   2. Run this file. It is COMPLETE on its own: one column, the public view (which now shows
--      `free`) and the two functions that read and write it (admin_catalog, save_product),
--      exactly as db/schema.sql has them. It needs migration 0003 to be there already.
--      Running db/schema.sql instead gives the same result. Safe to run twice. Nothing is
--      deleted: no existing product becomes free.
--
-- The functions below are copies of the ones in db/schema.sql; a test keeps them identical.

alter table products add column if not exists free boolean not null default false;

create or replace view public_catalog with (security_invoker = true) as
select
  p.id, p.slug, p.name, p.description, p.category, p.price, p.compare_at_price, p.images, p.options,
  p.stock, p.featured, p.min_quantity, p.attributes, p.created_at,
  coalesce(
    (select jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'stock', v.stock, 'price', v.price) order by v.id)
       from variants v where v.product_id = p.id and v.active),
    '[]'::jsonb
  ) as variants,
  p.type, p.unit, p.step, p.max_quantity, p.service, p.digital, p.free
from products p
where p.active and not p.draft;

create or replace function admin_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description, 'category', p.category,
    'price', p.price, 'compare_at_price', p.compare_at_price, 'images', p.images, 'options', p.options,
    'stock', p.stock, 'featured', p.featured, 'active', p.active, 'draft', p.draft, 'free', p.free, 'min_quantity', p.min_quantity,
    'attributes', p.attributes, 'created_at', p.created_at,
    'type', p.type, 'unit', p.unit, 'step', p.step, 'max_quantity', p.max_quantity, 'service', p.service,
    'digital', case when p.digital is null then null
                    else p.digital || jsonb_build_object('file', (select f.file from product_files f where f.product_id = p.id)) end,
    'variants', coalesce(
      (select jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'stock', v.stock, 'price', v.price) order by v.id)
         from variants v where v.product_id = p.id and v.active), '[]'::jsonb)
  ) order by p.created_at desc, p.id), '[]'::jsonb)
  from products p;
$$;

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
  -- Price 0 on something that is for sale is taken for an empty field, unless it says so: a
  -- draft (no price yet), a quote (priced per request) or a product marked FREE. And free means 0.
  if coalesce((p ->> 'free')::boolean, false) then
    if coalesce((p ->> 'price')::numeric, 0) <> 0 then
      raise exception 'PRODUCT_ERROR:price';
    end if;
  elsif coalesce((p ->> 'price')::numeric, 0) = 0 and coalesce(p ->> 'type', 'physical') <> 'quote'
     and not coalesce((p ->> 'draft')::boolean, false) and (p ->> 'price') is not null then
    raise exception 'PRODUCT_ERROR:price';
  end if;

  insert into products (id, slug, name, description, category, price, compare_at_price, images, options,
                        stock, featured, active, min_quantity, attributes, type, unit, step, max_quantity, service, digital, draft, free)
  values (v_id, p ->> 'slug', p ->> 'name', coalesce(p ->> 'description', ''), p ->> 'category',
          -- No price = a draft, stored as 0 and never sold (see `draft`). A quote has no public price by nature.
          coalesce((p ->> 'price')::numeric, 0), (p ->> 'compareAtPrice')::numeric,
          coalesce(p -> 'images', '[]'::jsonb), coalesce(p -> 'options', '[]'::jsonb),
          (p ->> 'stock')::numeric, coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'active')::boolean, true),
          coalesce((p ->> 'minQuantity')::numeric, 1), coalesce(p -> 'attributes', '{}'::jsonb),
          coalesce(p ->> 'type', 'physical'), coalesce(nullif(p ->> 'unit', ''), 'u'), coalesce((p ->> 'step')::numeric, 1),
          (p ->> 'maxQuantity')::numeric,
          case when jsonb_typeof(p -> 'service') = 'object' then p -> 'service' else null end,
          -- Only the visible name is kept with the product; the storage key goes to product_files.
          case when jsonb_typeof(p -> 'digital') = 'object' then (p -> 'digital') - 'file' else null end,
          coalesce((p ->> 'draft')::boolean, false) or ((p ->> 'price') is null and coalesce(p ->> 'type', 'physical') <> 'quote'),
          coalesce((p ->> 'free')::boolean, false))
  on conflict (id) do update set
    slug = excluded.slug, name = excluded.name, description = excluded.description, category = excluded.category,
    price = excluded.price, compare_at_price = excluded.compare_at_price, images = excluded.images,
    options = excluded.options, stock = excluded.stock, featured = excluded.featured, active = excluded.active,
    min_quantity = excluded.min_quantity, attributes = excluded.attributes, type = excluded.type, unit = excluded.unit,
    step = excluded.step, max_quantity = excluded.max_quantity, service = excluded.service, digital = excluded.digital,
    draft = excluded.draft, free = excluded.free;

  if coalesce(p #>> '{digital,file}', '') <> '' then
    insert into product_files (product_id, file) values (v_id, p #>> '{digital,file}')
    on conflict (product_id) do update set file = excluded.file;
  elsif jsonb_typeof(p -> 'digital') is distinct from 'object' then
    delete from product_files where product_id = v_id;
  end if;

  delete from variants where product_id = v_id
    and id not in (select x ->> 'id' from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) x);
  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    insert into variants (id, product_id, options, stock, price)
    values (v ->> 'id', v_id, v -> 'options', (v ->> 'stock')::numeric, (v ->> 'price')::numeric)
    on conflict (id) do update set options = excluded.options, stock = excluded.stock, price = excluded.price, active = true;
  end loop;

  return (select x from jsonb_array_elements(admin_catalog()) x where x ->> 'id' = v_id);
end;
$$;
