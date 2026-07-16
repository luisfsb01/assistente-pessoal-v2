-- Fase 8: web app — policies de RLS para as contas autenticadas (o casal).
-- O web passa a fazer CRUD direto (supabase-js + Auth) nas tabelas de domínio,
-- como já faz nas de finanças (policies herdadas da v1). App do casal: sem
-- segregação entre as duas contas (using true).
--
-- Fora daqui de propósito:
--   - llm_usage: o custo sai pelo endpoint GET /api/llm-cost (gasto + teto).
--   - memories insert: só o servidor cria memórias (embedding obrigatório);
--     edição de conteúdo pelo web vai via PUT /api/memories/:id (re-embedding).
--   - app_state: restrito às chaves de configuração — cursores e estados
--     internos continuam invisíveis ao web.

-- Tarefas e compras (CRUD completo no web)
create policy web_all on tasks
  for all to authenticated using (true) with check (true);
create policy web_all on shopping_items
  for all to authenticated using (true) with check (true);

-- Hábitos (CRUD + check-ins editáveis na grade)
create policy web_all on habits
  for all to authenticated using (true) with check (true);
create policy web_all on habit_checkins
  for all to authenticated using (true) with check (true);

-- Projetos (quadro, linha do tempo, tarefas)
create policy web_all on projects
  for all to authenticated using (true) with check (true);
create policy web_all on project_notes
  for all to authenticated using (true) with check (true);
create policy web_all on project_tasks
  for all to authenticated using (true) with check (true);

-- Memórias: listar, desativar/reativar/expirar e excluir pelo web.
-- (Sem insert; conteúdo editado via API para regerar o embedding.)
create policy web_select on memories for select to authenticated using (true);
create policy web_update on memories for update to authenticated using (true) with check (true);
create policy web_delete on memories for delete to authenticated using (true);

-- Users: leitura para mapear nomes/ids nas páginas (sem escrita)
create policy web_select on users for select to authenticated using (true);

-- App state: só as chaves de configuração do assistente
create policy web_config_select on app_state for select to authenticated
  using (key in ('proactivity_config', 'routines_config'));
create policy web_config_insert on app_state for insert to authenticated
  with check (key in ('proactivity_config', 'routines_config'));
create policy web_config_update on app_state for update to authenticated
  using (key in ('proactivity_config', 'routines_config'))
  with check (key in ('proactivity_config', 'routines_config'));

-- Custo do mês por finalidade (espelha o fuso de sum_month_cost_brl)
create or replace function month_cost_by_purpose()
returns table (purpose text, cost_brl numeric) language sql stable as $$
  select purpose, sum(cost_brl) as cost_brl
  from llm_usage
  where created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
  group by purpose
  order by sum(cost_brl) desc;
$$;
