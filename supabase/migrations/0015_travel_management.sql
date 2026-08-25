-- Viagens estruturadas e reservas (voos, hospedagem, carro e outros itens).
-- As listas de mala de 0013 continuam existindo e têm finalidade separada.

create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  destination text,
  purpose text,
  travelers text[] not null default '{}'::text[],
  notes text,
  start_date date,
  end_date date,
  status text not null default 'planning'
    check (status in ('planning', 'confirmed', 'completed', 'cancelled')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (destination is null or length(btrim(destination)) > 0),
  check (purpose is null or length(btrim(purpose)) > 0),
  check (notes is null or length(btrim(notes)) > 0),
  check (start_date is null or end_date is null or end_date >= start_date)
);

create table trip_reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  kind text not null check (kind in ('flight', 'hotel', 'car', 'transfer', 'event', 'other')),
  provider text,
  confirmation_code text,
  status text not null default 'booked' check (status in ('booked', 'pending', 'cancelled')),
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  origin text,
  destination text,
  address text,
  summary text not null check (length(btrim(summary)) > 0),
  details jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'gmail')),
  source_email_id text,
  source_email_subject text,
  source_email_date timestamptz,
  source_item_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider is null or length(btrim(provider)) > 0),
  check (confirmation_code is null or length(btrim(confirmation_code)) > 0),
  check (end_at is null or start_at is null or end_at >= start_at),
  check (
    (source = 'manual' and source_email_id is null and source_item_key is null)
    or
    (source = 'gmail' and source_email_id is not null and source_item_key is not null)
  )
);

create index trips_dates_idx on trips (start_date, end_date);
create index trips_status_idx on trips (status, updated_at desc);
create index trip_reservations_trip_idx on trip_reservations (trip_id, start_at, created_at);
create unique index trip_reservations_gmail_item_uidx
  on trip_reservations (trip_id, source_email_id, source_item_key);
create unique index trip_reservations_confirmation_uidx
  on trip_reservations (trip_id, kind, confirmation_code)
  where confirmation_code is not null;

alter table trips enable row level security;
alter table trip_reservations enable row level security;

create policy web_all on trips
  for all to authenticated using (true) with check (true);
create policy web_all on trip_reservations
  for all to authenticated using (true) with check (true);

create policy app_members_only on trips as restrictive
  for all to anon, authenticated
  using (public.is_app_member()) with check (public.is_app_member());
create policy app_members_only on trip_reservations as restrictive
  for all to anon, authenticated
  using (public.is_app_member()) with check (public.is_app_member());
