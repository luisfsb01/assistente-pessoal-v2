-- Fase 6: índice semântico do segundo cérebro (espelho derivado dos arquivos do vault)
create table knowledge_index (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  chunk_no int not null,
  content text not null,
  embedding vector(1536) not null,
  file_hash text not null,
  updated_at timestamptz not null default now(),
  unique (path, chunk_no)
);
create index knowledge_index_embedding_idx on knowledge_index using hnsw (embedding vector_cosine_ops);
alter table knowledge_index enable row level security;

create or replace function match_knowledge(
  query_embedding vector(1536),
  match_count int default 6
) returns table (path text, chunk_no int, content text, similarity float)
language sql stable as $$
  select k.path, k.chunk_no, k.content,
         1 - (k.embedding <=> query_embedding) as similarity
  from knowledge_index k
  order by k.embedding <=> query_embedding
  limit match_count;
$$;
