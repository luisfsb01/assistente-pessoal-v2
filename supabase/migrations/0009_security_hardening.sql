-- Hardening de segurança: membros explícitos, RLS defensiva, RPCs mínimas e
-- claim atômico para impedir disparo duplicado de rotinas após restart/deploy.

create table if not exists public.app_members (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Preserva o acesso das contas que já existiam no momento da migração.
-- Contas criadas depois ficam bloqueadas até inserção explícita nesta tabela.
insert into public.app_members (auth_user_id)
select id from auth.users
on conflict do nothing;

alter table public.app_members enable row level security;
revoke all on table public.app_members from public, anon, authenticated;

create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m where m.auth_user_id = auth.uid()
  );
$$;
revoke all on function public.is_app_member() from public, anon;
grant execute on function public.is_app_member() to anon, authenticated, service_role;

-- Policies RESTRICTIVE são combinadas com as policies permissivas existentes.
-- Assim, mesmo tabelas herdadas da v1 passam a exigir associação em app_members.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'chats', 'messages', 'tasks', 'shopping_items', 'habits', 'habit_checkins',
    'projects', 'project_notes', 'project_tasks', 'memories', 'llm_usage',
    'app_state', 'event_queue', 'knowledge_index',
    'categories', 'transactions', 'financial_commitments', 'goals', 'category_rules'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists app_members_only on public.%I', table_name);
      execute format(
        'create policy app_members_only on public.%I as restrictive for all to anon, authenticated using (public.is_app_member()) with check (public.is_app_member())',
        table_name
      );
    end if;
  end loop;
end $$;

-- RPCs internas deixam de estar executáveis por anon/authenticated.
revoke all on function public.match_memories(vector, text[], integer) from public, anon, authenticated;
grant execute on function public.match_memories(vector, text[], integer) to service_role;
revoke all on function public.match_knowledge(vector, integer) from public, anon, authenticated;
grant execute on function public.match_knowledge(vector, integer) to service_role;
revoke all on function public.sum_month_cost_brl() from public, anon, authenticated;
grant execute on function public.sum_month_cost_brl() to service_role;
revoke all on function public.month_cost_by_purpose() from public, anon, authenticated;
grant execute on function public.month_cost_by_purpose() to service_role;
revoke all on function public.monthly_cashflow(integer) from public, anon;
grant execute on function public.monthly_cashflow(integer) to authenticated, service_role;

create or replace function public.claim_scheduled_run(p_key text, p_slot text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_key !~ '^[a-zA-Z0-9:_-]{1,80}$' or length(p_slot) not between 1 and 40 then
    raise exception 'invalid scheduled run key/slot';
  end if;

  insert into public.app_state(key, value)
  values ('scheduled_run:' || p_key, jsonb_build_object('slot', p_slot, 'claimed_at', now()))
  on conflict (key) do update
    set value = excluded.value
    where public.app_state.value ->> 'slot' is distinct from p_slot;

  return found;
end;
$$;
revoke all on function public.claim_scheduled_run(text, text) from public, anon, authenticated;
grant execute on function public.claim_scheduled_run(text, text) to service_role;
