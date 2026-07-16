-- Fase 7: hábitos (meta semanal + check-ins) e projetos (linha do tempo + quadro)
create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  target_per_week int not null check (target_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table habit_checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  date date not null,
  done boolean not null,
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  status text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('status','decision','note')),
  content text not null,
  created_at timestamptz not null default now()
);

create table project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index habit_checkins_date_idx on habit_checkins (habit_id, date);
create index project_tasks_due_idx on project_tasks (due_date) where due_date is not null;

alter table habits enable row level security;
alter table habit_checkins enable row level security;
alter table projects enable row level security;
alter table project_notes enable row level security;
alter table project_tasks enable row level security;

-- proatividade: projeto parado entra na fila de eventos
alter table event_queue drop constraint event_queue_source_check;
alter table event_queue add constraint event_queue_source_check
  check (source in ('finance','calendar','tasks','gmail','projects'));
