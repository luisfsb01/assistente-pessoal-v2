-- Fase 4: fila de eventos do motor de proatividade (auditável: decisão + motivo)
create table event_queue (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('finance','calendar','tasks')),
  kind text not null,
  dedupe_key text not null unique,
  summary text not null,
  payload jsonb,
  decision text check (decision in ('notify','briefing','ignore')),
  reason text,
  target text check (target in ('luis','esposa','grupo')),
  status text not null default 'pending'
    check (status in ('pending','ignored','queued','notified','briefed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  delivered_at timestamptz
);
create index event_queue_status_idx on event_queue (status, created_at);
create index event_queue_delivered_idx on event_queue (delivered_at) where delivered_at is not null;

alter table event_queue enable row level security;
