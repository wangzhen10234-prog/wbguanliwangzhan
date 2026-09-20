-- Server-only whole-market niche analytics storage. No browser policies are granted.
create table if not exists public.market_data_sources (id text primary key, source text not null, confidence text not null, source_file text not null default '', imported_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb);
create table if not exists public.market_categories (subject_id text primary key, name_ru text not null, name_zh text not null default '', parent_id text not null default '', parent_name text not null default '', level integer not null default 1, updated_at timestamptz not null default now());
create table if not exists public.market_category_metrics (subject_id text not null, period_days integer not null, metric_date date not null, source_id text not null, metrics jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key(subject_id, period_days, metric_date, source_id));
create table if not exists public.market_category_history (subject_id text not null, period_days integer not null, metric_date date not null, source_id text not null, metrics jsonb not null default '{}'::jsonb, primary key(subject_id, period_days, metric_date, source_id));
create table if not exists public.market_products (subject_id text not null, nm_id bigint not null, source_id text not null, payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key(subject_id, nm_id, source_id));
create table if not exists public.market_sellers (subject_id text not null, seller_id text not null, source_id text not null, payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key(subject_id, seller_id, source_id));
create table if not exists public.market_watchlist (subject_id text primary key, created_at timestamptz not null default now(), note text not null default '');
create index if not exists market_metrics_period_date_idx on public.market_category_metrics(period_days, metric_date desc);
create index if not exists market_history_subject_date_idx on public.market_category_history(subject_id, metric_date desc);
alter table public.market_data_sources enable row level security;
alter table public.market_categories enable row level security;
alter table public.market_category_metrics enable row level security;
alter table public.market_category_history enable row level security;
alter table public.market_products enable row level security;
alter table public.market_sellers enable row level security;
alter table public.market_watchlist enable row level security;
