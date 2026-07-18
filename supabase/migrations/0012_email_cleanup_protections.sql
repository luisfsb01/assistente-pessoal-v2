-- Regras aprendidas pelo bot para impedir que tipos conhecidos de e-mail
-- sejam enviados automaticamente à lixeira.
create table if not exists public.email_cleanup_protections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  match_on text not null check (match_on in ('sender', 'domain', 'subject', 'any')),
  match_value text not null check (char_length(trim(match_value)) between 2 and 200),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists email_cleanup_protections_unique
  on public.email_cleanup_protections (user_id, match_on, match_value);

create index if not exists email_cleanup_protections_user_active
  on public.email_cleanup_protections (user_id, active)
  where active = true;

alter table public.email_cleanup_protections enable row level security;
revoke all on table public.email_cleanup_protections from public, anon, authenticated;
