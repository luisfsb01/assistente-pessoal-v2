-- Recibos duráveis das ações solicitadas por agentes externos (Hermes).
-- A tabela não é acessível pelo navegador; somente o backend com service_role.

create table if not exists public.agent_operations (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('hermes')),
  tool_name text not null check (tool_name ~ '^[a-z0-9_]{1,80}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_at timestamptz,
  unique (source, idempotency_key)
);

create index if not exists agent_operations_recent_idx
  on public.agent_operations (source, started_at desc);

alter table public.agent_operations enable row level security;
revoke all on table public.agent_operations from public, anon, authenticated;
grant all on table public.agent_operations to service_role;
