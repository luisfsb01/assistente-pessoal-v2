# Fase 9 — Dashboard financeiro (melhorias adiadas da F1.5)

**Data:** 2026-07-17 · **Status:** aprovado no brainstorm (abordagem B + paginação client-side)

A F9 substitui a "Virada" do design original (§10): a v1 já foi desligada na
F1.5. O que restou do roadmap é o backlog priorizado do dashboard financeiro,
adiado desde então. Escopo decidido: os 4 blocos abaixo + testes.

## 1. Agregação anual no banco (migração 0008)

Hoje o Dashboard baixa TRÊS conjuntos de transações (período atual, período
anterior e o ANO inteiro) e agrega tudo em JS (`finance-data.ts`). O
PostgREST corta em 1000 linhas por padrão — quando o ano passar disso, o
gráfico anual e o KPI "saldo no ano" ficam silenciosamente errados. Correção:

- **Função SQL `monthly_cashflow(p_year int)`** (migração
  `supabase/migrations/0008_fase9.sql`) → 12 linhas
  `(month int, income numeric, expense numeric, invested numeric)`.
  Espelha a lógica de `finance-data.ts` com CTE recursiva na árvore de
  categorias: raiz de tipo `investment` → conta como investido (despesa soma,
  receita subtrai); `counts=false` em qualquer ancestral → transação fora dos
  totais; demais → income/expense por `kind`. `security invoker` — as
  policies de `transactions`/`categories` (herdadas da v1) já dão leitura às
  contas autenticadas.
- **Hook novo `useYearCashflow(year)`** (`apps/web/src/lib/`) chama a RPC.
  O gráfico Receitas×Despesas anual e o KPI "saldo no ano" (= soma dos
  meses) passam a usar esse resultado. O download do ano inteiro morre.
- **`useFinance` pagina em loop**: busca em páginas de 1000
  (`.range(offset, offset+999)`) até vir página curta — o período
  atual/anterior nunca trunca, e a lógica JS testada continua a fonte da
  verdade para os KPIs do período e os gráficos de categoria.

## 2. Paginação em Transações (client-side)

Decisão (assinada no brainstorm): a página tem totais do filtro, seleção em
lote com "selecionar todos" e export CSV que operam sobre o conjunto
filtrado INTEIRO — paginação server-side quebraria os três ou exigiria RPCs
extras. Para o volume do casal (centenas de linhas/mês), o certo é:

- Fetch do período com o mesmo loop paginado do `useFinance` (nunca trunca).
- **Paginar só a renderização**: 50 linhas por página, controles ‹ › com
  "X–Y de N" sobre o conjunto filtrado. Trocar filtro/período volta à
  página 1.
- Totais, selecionar-todos, edição em lote e export continuam operando sobre
  o filtro inteiro (comportamento inalterado).

## 3. Modais no lugar de alert/confirm

`Transacoes.tsx` (excluir 1, excluir N em lote, erros de gravação),
`Categorias.tsx` (excluir, erro de exclusão em uso) e `Objetivos.tsx`
(excluir, erro) trocam `window.confirm`/`alert` pelo `Modal` existente
(`components/Modal.tsx`) com confirmação explícita e erro inline — padrão
das páginas da F8. Nenhum `alert()`/`confirm()` sobra no app.

## 4. Passada de mobile (páginas de finanças)

Ajustes pontuais, sem redesign: tabela de transações com `overflow-x-auto`
e larguras mínimas; gráficos com altura responsiva; grids de
Dashboard/Categorias/Objetivos empilhando corretamente no celular; controles
de filtro quebrando linha. Critério visual: usável num celular comum sem
scroll horizontal da página (a tabela rola dentro do próprio container).

## 5. Testes

- `vitest.config.ts` passa a incluir `apps/web/src/lib/**/*.test.ts` —
  o `finance-data.test.ts` JÁ EXISTE mas nunca rodou (runner só incluía o
  server). Lógica pura, sem DOM — roda no node sem setup extra.
- O loop de fetch paginado vira helper puro com teste próprio (ex.:
  `fetchAllPages` — pagina até página curta, concatena, propaga erro).
- A função SQL é validada no UAT comparando o gráfico anual com o cálculo
  JS do mesmo ano (uma vez); vitest não cobre SQL (padrão do repo).
- Páginas/hooks continuam sem teste de UI (backlog conhecido).

## Fora da fase

Proxy/TLS na frente da 8080 (infra, segue no backlog); backlog técnico das
fases anteriores (throttling 429, guards de duplo-clique, cache do tick,
escape do ilike etc.); redesign visual; import de dados da v1.

## Critério da fase

Dashboard carrega rápido baixando só o período corrente + 12 linhas de
agregado anual (correto com qualquer volume); Transações paginada e sem
nenhum `alert()`/`confirm()` no app; páginas de finanças usáveis no celular;
`finance-data.test.ts` rodando na suite.
