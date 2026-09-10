-- WB Insight core schema for Supabase Postgres.
--
-- This migration mirrors the four persistent Cloudflare D1 tables used by the
-- current production application.  It is intentionally server-only: RLS is
-- enabled and no anon/authenticated policies are created.  Application servers
-- must use SUPABASE_SERVICE_ROLE_KEY; never expose that key to the browser.

create table if not exists public.product_costs (
  store_id text not null default 'primary',
  seller_sku text not null,
  nm_id bigint,
  image_url text not null default '',
  internal_sku text not null default '',
  category text not null default '',
  specification text not null default '',
  length_cm double precision not null default 0,
  width_cm double precision not null default 0,
  height_cm double precision not null default 0,
  weight_g double precision not null default 0,
  product_cost_rub double precision not null default 0,
  exchange_rate double precision not null default 11.2,
  product_cost_cny double precision not null default 0,
  handling_fee_cny double precision not null default 0,
  last_mile_fee_cny double precision not null default 0,
  commission_rate double precision not null default 0,
  ad_rate double precision not null default 0,
  activity_discount_rate double precision not null default 0,
  return_loss_rate double precision not null default 0,
  reference_price_cny double precision not null default 0,
  target_margin_rate double precision not null default 10,
  sort_order double precision not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_costs_store_seller_pk primary key (store_id, seller_sku)
);

create index if not exists product_costs_store_sort_idx
  on public.product_costs (store_id, sort_order, seller_sku);

create index if not exists product_costs_store_nm_idx
  on public.product_costs (store_id, nm_id)
  where nm_id is not null;

create table if not exists public.product_cost_deletions (
  store_id text not null default 'primary',
  identity_key text not null,
  seller_sku_key text not null,
  nm_id bigint,
  deleted_at timestamptz not null default now(),
  constraint product_cost_deletions_store_identity_pk
    primary key (store_id, identity_key)
);

create index if not exists product_cost_deletions_store_seller_idx
  on public.product_cost_deletions (store_id, seller_sku_key);

create table if not exists public.wb_sync_snapshots (
  cache_key text primary key,
  payload text not null,
  sync_slot text not null default '',
  manual_bucket bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists wb_sync_snapshots_updated_idx
  on public.wb_sync_snapshots (updated_at desc);

create table if not exists public.wb_sync_locks (
  cache_key text primary key,
  expires_at bigint not null
);

alter table public.product_costs enable row level security;
alter table public.product_cost_deletions enable row level security;
alter table public.wb_sync_snapshots enable row level security;
alter table public.wb_sync_locks enable row level security;

-- Keep updated_at correct even when a future client omits it during updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_costs_set_updated_at on public.product_costs;
create trigger product_costs_set_updated_at
before update on public.product_costs
for each row execute function public.set_updated_at();

