-- Coexistência v1 → v2 no MESMO projeto Supabase (aprovado por Luis em 2026-07-10).
-- Roda ANTES da 0001_init.sql.
--
-- MANTÉM (dashboard/web da v1 continua funcionando sobre elas):
--   categories, transactions, financial_commitments, goals, category_rules
--   + contas do Supabase Auth (não tocadas)
-- APAGA: tabelas do bot da v1, substituídas pelas da v2 (perde histórico de
--   conversas, tarefas, lista de compras, rotinas e lembretes da v1)
-- APAGA: transações fora de junho/2026 (backup exportado em data/v1-export/)

-- 1. Tabelas do bot da v1 (dependentes primeiro; cascade cobre FKs restantes)
drop table if exists recurring_reminders cascade;
drop table if exists bank_sync_state cascade;
drop table if exists routing_config cascade;
drop table if exists shopping_items cascade;
drop table if exists tasks cascade;
drop table if exists messages cascade;
drop table if exists chats cascade;
drop table if exists users cascade;

-- 2. Só as transações de junho/2026 ficam (categorização já revisada)
delete from transactions
where occurred_on < '2026-06-01' or occurred_on > '2026-06-30';
