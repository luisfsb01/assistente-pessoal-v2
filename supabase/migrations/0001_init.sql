create extension if not exists vector;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text unique not null check (subject in ('luis','esposa')),
  telegram_chat_id bigint unique not null
);

create table chats (
  id bigint primary key,
  kind text not null check (kind in ('private','group')),
  user_id uuid references users(id)
);

create table messages (
  id bigserial primary key,
  chat_id bigint not null references chats(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index messages_chat_created_idx on messages (chat_id, created_at desc);

create table memories (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (subject in ('luis','esposa','casal')),
  type text not null check (type in ('preference','habit','fact','decision','person')),
  content text not null,
  embedding vector(1536) not null,
  source text not null default 'conversation',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index memories_embedding_idx on memories using hnsw (embedding vector_cosine_ops);

create table llm_usage (
  id bigserial primary key,
  model text not null,
  purpose text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_brl numeric(10,4) not null,
  created_at timestamptz not null default now()
);
create index llm_usage_created_idx on llm_usage (created_at);

create table app_state (
  key text primary key,
  value jsonb not null
);

create or replace function match_memories(
  query_embedding vector(1536),
  subjects text[],
  match_count int default 6
) returns table (id uuid, subject text, type text, content text, similarity float)
language sql stable as $$
  select m.id, m.subject, m.type, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.active
    and m.subject = any(subjects)
    and (m.expires_at is null or m.expires_at > now())
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function sum_month_cost_brl()
returns numeric language sql stable as $$
  select coalesce(sum(cost_brl), 0)
  from llm_usage
  where created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
$$;

alter table users enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
alter table llm_usage enable row level security;
alter table app_state enable row level security;
