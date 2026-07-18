-- Fase 9: agregação anual do dashboard no banco.
-- Corrige o corte de 1000 linhas do PostgREST (o web baixava o ano inteiro de
-- transações e agregava em JS) e elimina esse download.
-- Espelha a lógica de apps/web/src/lib/finance-data.ts:
--   - raiz da árvore de categorias com type='investment' → conta como
--     investido (despesa soma, receita subtrai);
--   - counts=false na categoria OU em qualquer ancestral → fora dos totais;
--   - sem categoria (ou categoria desconhecida) → conta como income/expense.
-- security invoker (default): as policies de transactions/categories herdadas
-- da v1 já dão leitura às contas autenticadas do casal.
create or replace function monthly_cashflow(p_year int)
returns table (month int, income numeric, expense numeric, invested numeric)
language sql stable as $$
  with recursive cat_info as (
    select id, id as root_id, (counts = false) as excluded
    from categories
    where parent_id is null
    union all
    select c.id, ci.root_id, (ci.excluded or c.counts = false)
    from categories c
    join cat_info ci on c.parent_id = ci.id
  ),
  tx as (
    select t.amount,
           t.kind,
           extract(month from t.occurred_on)::int as m,
           coalesce(ci.excluded, false) as excluded,
           coalesce(r.type, '') = 'investment' as is_inv
    from transactions t
    left join cat_info ci on ci.id = t.category_id
    left join categories r on r.id = ci.root_id
    where extract(year from t.occurred_on)::int = p_year
  )
  select gs.m as month,
         coalesce(sum(t.amount) filter (where not t.excluded and not t.is_inv and t.kind = 'income'), 0) as income,
         coalesce(sum(t.amount) filter (where not t.excluded and not t.is_inv and t.kind = 'expense'), 0) as expense,
         coalesce(sum(case when t.kind = 'expense' then t.amount else -t.amount end)
                  filter (where not t.excluded and t.is_inv), 0) as invested
  from generate_series(1, 12) gs(m)
  left join tx t on t.m = gs.m
  group by gs.m
  order by gs.m;
$$;
