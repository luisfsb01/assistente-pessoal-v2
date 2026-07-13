-- Fase 2: tarefas por pessoa, lista de compras do casal, agenda por usuário
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index tasks_user_status_idx on tasks (user_id, status);

create table shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  added_by uuid references users(id),
  created_at timestamptz not null default now()
);

alter table users add column calendar_id text;

alter table tasks enable row level security;
alter table shopping_items enable row level security;
