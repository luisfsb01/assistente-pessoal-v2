-- Listas compartilhadas de viagem e pedidos de oração individuais.

create table travel_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  travel_date date not null,
  created_by uuid references users(id),
  cleanup_prompted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, travel_date)
);

create table travel_items (
  id uuid primary key default gen_random_uuid(),
  travel_list_id uuid not null references travel_lists(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  added_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table prayer_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  purpose text,
  person_name text not null check (length(btrim(person_name)) > 0),
  request text not null check (length(btrim(request)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purpose is null or length(btrim(purpose)) > 0)
);

create index travel_lists_date_idx on travel_lists (travel_date);
create index travel_items_list_idx on travel_items (travel_list_id, created_at);
create index prayer_requests_owner_idx on prayer_requests (owner_id, created_at);

alter table travel_lists enable row level security;
alter table travel_items enable row level security;
alter table prayer_requests enable row level security;

-- O web é privado ao casal. Ambos podem visualizar as listas de oração um do
-- outro; a coluna owner_id mantém claramente a separação individual.
create policy web_all on travel_lists
  for all to authenticated using (true) with check (true);
create policy web_all on travel_items
  for all to authenticated using (true) with check (true);
create policy web_all on prayer_requests
  for all to authenticated using (true) with check (true);

-- Mantém o hardening introduzido em 0009 também nas tabelas novas.
create policy app_members_only on travel_lists as restrictive
  for all to anon, authenticated
  using (public.is_app_member()) with check (public.is_app_member());
create policy app_members_only on travel_items as restrictive
  for all to anon, authenticated
  using (public.is_app_member()) with check (public.is_app_member());
create policy app_members_only on prayer_requests as restrictive
  for all to anon, authenticated
  using (public.is_app_member()) with check (public.is_app_member());
