-- Cerebro Web — migration 0004: free products (0.3.0 → 0.3.1).
--
-- Price 0 on something for sale is refused as an empty field. A product that is FREE ON PURPOSE
-- (a free download, a sample, an open class) says so: `products.free`.
--
-- HOW TO APPLY IT (ask the owner first: it changes a real database)
--   1. Make a backup.
--   2. Run this file. It is COMPLETE on its own: one column, what the public key can read (a
--      price of 0 that is not marked free is kept off the store, like a draft), the public view
--      and the three functions that read and write `free` (create_order, admin_catalog,
--      save_product), exactly as db/schema.sql has them. create_order now refuses a line at 0
--      that is not free, caps free places per buyer and pays an all-free order on the spot. It needs migration 0003 to be there already.
--      Running db/schema.sql instead gives the same result. Safe to run twice. Nothing is
--      deleted: no existing product becomes free. A product ON SALE AT PRICE 0 stops being
--      shown until it is marked free (or given a price). List them first with:
--        select id, name from products where active and not draft and price = 0 and type <> 'quote';
--
-- The functions below are copies of the ones in db/schema.sql; a test keeps them identical.

alter table products add column if not exists free boolean not null default false;

drop policy if exists public_read on products;
-- On sale = active, not a draft, and with a price that is meant: above 0, or 0 on a product
-- marked free (or a quote, which has no public price). An unmarked 0 is an empty field.
create policy public_read on products for select using (active and not draft and (price > 0 or free or type = 'quote'));
drop policy if exists public_read on variants;
create policy public_read on variants for select
  using (active and exists (select 1 from products p where p.id = variants.product_id and p.active and not p.draft
                              and (p.price > 0 or p.free or p.type = 'quote')));

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
where p.active and not p.draft and (p.price > 0 or p.free or p.type = 'quote');

create or replace function create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key       text := p ->> 'idempotency_key';
  v_id        text;
  v_line      jsonb;
  v_pos       int := 0;
  v_qty       numeric(12, 3);
  v_product   products%rowtype;
  v_physical  boolean := false;
  v_slot_from timestamptz;
  v_slot_to   timestamptz;
  v_booked    numeric;
  v_slots     int := 0;
  v_open      int;
  v_variant   variants%rowtype;
  v_has_var   boolean;
  v_selection jsonb;
  v_opt       jsonb;
  v_label     text;
  v_price     numeric(12, 2);
  v_image     text;
  v_subtotal  numeric(12, 2) := 0;
  v_shipping  numeric(12, 2);
  v_max       numeric := coalesce((p ->> 'max_quantity')::numeric, 20);
  v_taken     boolean;
  v_all_free  boolean := true;
  v_mine      numeric;
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
    v_qty := round((v_line ->> 'quantity')::numeric, 3);

    -- Locked: the stock and the seats of this product are decided by one buyer at a time.
    -- A draft (no price yet) is not for sale: for the store it does not exist. Neither does a
    -- product at price 0 that is not marked free (an empty price field) — the same rule as the
    -- public catalogue.
    select * into v_product from products
      where id = v_line ->> 'product_id' and active and not draft and (price > 0 or free or type = 'quote') for update;
    if not found then
      raise exception 'ORDER_ERROR:unknown_product:%', v_line ->> 'product_id';
    end if;
    -- A product without a public price is never bought: it is asked for (create_quote).
    if v_product.type = 'quote' then
      raise exception 'ORDER_ERROR:quote_only:%', v_product.id;
    end if;
    if v_qty is null or v_qty < v_product.min_quantity or v_qty > coalesce(v_product.max_quantity, v_max)
       or mod(v_qty, v_product.step) <> 0 then
      raise exception 'ORDER_ERROR:quantity:%', v_product.id;
    end if;
    -- A download is one licence per line; seats are whole.
    if (v_product.type = 'digital' and v_qty <> 1) or (v_product.type = 'service' and v_qty <> trunc(v_qty)) then
      raise exception 'ORDER_ERROR:quantity:%', v_product.id;
    end if;
    v_physical := v_physical or v_product.type = 'physical';

    v_slot_from := null;
    v_slot_to := null;
    if v_product.type = 'service' then
      v_slot_from := (v_line ->> 'slot_start')::timestamptz;
      v_slot_to := (v_line ->> 'slot_end')::timestamptz;
      if v_slot_from is null or v_slot_to is null or v_slot_to <= v_slot_from then
        raise exception 'ORDER_ERROR:slot_required:%', v_product.id;
      end if;
      -- One order cannot hoard the calendar.
      v_slots := v_slots + 1;
      if v_slots > coalesce((p ->> 'max_slots')::int, 3) then
        raise exception 'ORDER_ERROR:booking_limit:%', coalesce(p ->> 'max_slots', '3');
      end if;
      -- Seats already held during this time (this order included). OVERLAP, not "same start": an
      -- appointment taken when the service lasted longer still blocks the time it occupies.
      -- Cancelled orders hold nothing, and neither does an unpaid order whose hold has lapsed.
      select coalesce(sum(l.quantity), 0) into v_booked
        from order_lines l join orders o on o.id = l.order_id
        where l.product_id = v_product.id and l.slot_start < v_slot_to and l.slot_end > v_slot_from
          and o.status <> 'cancelled'
          and (o.paid_at is not null or o.hold_until is null or o.hold_until > now());
      if v_booked + v_qty > greatest(coalesce((v_product.service ->> 'capacity')::int, 1), 1) then
        raise exception 'ORDER_ERROR:slot_taken:%', v_product.id;
      end if;
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
        -- The row is locked since it was read: two buyers cannot take the last unit.
        if v_product.stock < v_qty then
          raise exception 'ORDER_ERROR:out_of_stock:%', v_product.id;
        end if;
        update products set stock = stock - v_qty where id = v_product.id;
        v_taken := true;
      end if;
    end if;

    -- NOTHING IS GIVEN AWAY BY ACCIDENT. A line costs 0 only when its product is marked free; a
    -- variant at 0 on a priced product, or a quantity so small that the line rounds to 0, is refused.
    if v_price = 0 and not v_product.free then
      raise exception 'ORDER_ERROR:no_price:%', v_product.id;
    end if;
    if v_price > 0 and round(v_price * v_qty, 2) = 0 then
      raise exception 'ORDER_ERROR:quantity:%', v_product.id;
    end if;
    v_all_free := v_all_free and v_product.free and v_price = 0;
    -- A free place costs nothing to take, so the unpaid-booking limit does not stop one person
    -- from taking them all: seats per buyer (e-mail) per date are capped, paid ones included.
    if v_price = 0 and v_slot_from is not null then
      select coalesce(sum(l.quantity), 0) into v_mine
        from order_lines l join orders o on o.id = l.order_id
        where l.product_id = v_product.id and l.slot_start < v_slot_to and l.slot_end > v_slot_from
          and o.status <> 'cancelled'
          and lower(o.customer ->> 'email') = lower(p #>> '{customer,email}');
      if v_mine + v_qty > coalesce((p ->> 'max_free_seats')::int, 2) then
        raise exception 'ORDER_ERROR:free_seat_limit:%', coalesce(p ->> 'max_free_seats', '2');
      end if;
    end if;

    select img ->> 'src' into v_image
      from jsonb_array_elements(v_product.images) with ordinality as i (img, ord)
      order by (case when img ? 'option' and v_selection @> (img -> 'option') then 0 else 1 end), ord
      limit 1;

    insert into order_lines (order_id, position, product_id, variant_id, name, variant_label, selection, quantity, unit_price,
                             image, stock_taken, type, unit, slot_start, slot_end)
    values (v_id, v_pos, v_product.id, v_variant.id, v_product.name, v_label, v_selection, v_qty, v_price,
            v_image, v_taken, v_product.type, v_product.unit, v_slot_from, v_slot_to);

    -- Each line is rounded to cents on its own; the subtotal adds the rounded lines.
    v_subtotal := v_subtotal + round(v_price * v_qty, 2);
  end loop;

  -- (The minimum order is about money: a cart of free products only is not held to it.)
  if not v_all_free and v_subtotal < coalesce((p ->> 'minimum_order')::numeric, 0) then
    raise exception 'ORDER_ERROR:minimum_order:%', p ->> 'minimum_order';
  end if;

  v_shipping := coalesce((p #>> '{shipping,price}')::numeric, 0);
  if (p #>> '{shipping,free_from}') is not null and v_subtotal >= (p #>> '{shipping,free_from}')::numeric then
    v_shipping := 0;
  end if;
  -- SHIPPING ONLY IF SOMETHING IS SHIPPED: a booking and a download travel nowhere.
  if not v_physical then
    v_shipping := 0;
  end if;

  if v_slots > 0 then
    -- …and one buyer cannot sit on many unpaid appointments at a time.
    select count(*) into v_open
      from order_lines l join orders o on o.id = l.order_id
      where l.slot_start is not null and o.id <> v_id and o.status = 'new' and o.paid_at is null
        and (o.hold_until is null or o.hold_until > now())
        and lower(o.customer ->> 'email') = lower(p #>> '{customer,email}');
    if v_open + v_slots > coalesce((p ->> 'max_unpaid_slots')::int, 3) then
      raise exception 'ORDER_ERROR:booking_limit:%', coalesce(p ->> 'max_unpaid_slots', '3');
    end if;
  end if;

  update orders set subtotal = v_subtotal, shipping_price = v_shipping, total = v_subtotal + v_shipping,
                    shipping_method = case when v_physical then shipping_method else 'none' end,
                    hold_until = case when v_slots > 0
                      then now() + make_interval(secs => (coalesce((p ->> 'hold_hours')::numeric, 12) * 3600)::double precision)
                      else null end
  where id = v_id;

  -- NOTHING TO PAY: every line is a free product and the total is 0. The order is paid HERE, in
  -- the same transaction that created it — never by a second call that could fail on its own.
  if v_all_free and v_subtotal + v_shipping = 0 then
    update orders set status = 'paid', paid_at = now(), hold_until = null where id = v_id;
    insert into order_events (order_id, type, from_status, to_status, actor, text)
    values (v_id, 'status', 'new', 'paid', 'store', 'free');
  end if;
  return order_json(v_id);
end;
$$;

create or replace function admin_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description, 'category', p.category,
    'price', p.price, 'compare_at_price', p.compare_at_price, 'images', p.images, 'options', p.options,
    'stock', p.stock, 'featured', p.featured, 'active', p.active,
    -- A price of 0 that is not marked free is an empty field: the panel shows it as a draft.
    'draft', p.draft or (p.price = 0 and not p.free and p.type <> 'quote'), 'free', p.free, 'min_quantity', p.min_quantity,
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

  -- A variant with its own price follows the same rule: never 0 on a priced product, and no
  -- price of its own on a free one.
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) x
             where (x ->> 'price') is not null
               and (case when coalesce((p ->> 'free')::boolean, false) then (x ->> 'price')::numeric <> 0 else (x ->> 'price')::numeric = 0 end)
               and coalesce(p ->> 'type', 'physical') <> 'quote') then
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
