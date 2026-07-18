-- Tarefas recorrentes: existe apenas uma ocorrência ativa por série.
-- A próxima é criada somente quando a atual muda de open para done.
alter table public.tasks
  add column if not exists recurrence_unit text,
  add column if not exists recurrence_interval integer,
  add column if not exists recurrence_until date,
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_occurrence integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_recurrence_unit_check') then
    alter table public.tasks add constraint tasks_recurrence_unit_check
      check (recurrence_unit is null or recurrence_unit in ('day', 'week', 'month'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_recurrence_interval_check') then
    alter table public.tasks add constraint tasks_recurrence_interval_check
      check (recurrence_interval is null or recurrence_interval between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_recurrence_complete_check') then
    alter table public.tasks add constraint tasks_recurrence_complete_check check (
      (recurrence_unit is null and recurrence_interval is null and recurrence_until is null
        and recurrence_series_id is null and recurrence_occurrence is null)
      or
      (recurrence_unit is not null and recurrence_interval is not null and recurrence_until is not null
        and recurrence_series_id is not null and recurrence_occurrence is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_recurrence_until_check') then
    alter table public.tasks add constraint tasks_recurrence_until_check
      check (recurrence_until is null or due_date is null or recurrence_until >= due_date);
  end if;
end $$;

create unique index if not exists tasks_recurrence_occurrence_unique
  on public.tasks (recurrence_series_id, recurrence_occurrence)
  where recurrence_series_id is not null;

create or replace function public.prepare_task_recurrence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.recurrence_unit is null then
    new.recurrence_interval := null;
    new.recurrence_until := null;
    new.recurrence_series_id := null;
    new.recurrence_occurrence := null;
    return new;
  end if;

  new.recurrence_interval := coalesce(new.recurrence_interval, 1);
  if new.recurrence_until is null then
    raise exception 'recurrence_until is required for recurring tasks';
  end if;
  new.recurrence_series_id := coalesce(new.recurrence_series_id, gen_random_uuid());
  new.recurrence_occurrence := coalesce(new.recurrence_occurrence, 1);
  return new;
end;
$$;

drop trigger if exists tasks_prepare_recurrence on public.tasks;
create trigger tasks_prepare_recurrence
before insert or update of recurrence_unit, recurrence_interval, recurrence_until,
  recurrence_series_id, recurrence_occurrence on public.tasks
for each row execute function public.prepare_task_recurrence();

create or replace function public.create_next_recurring_task()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  base_date date;
  next_due date;
begin
  if old.status = 'done' or new.status <> 'done' or new.recurrence_unit is null then
    return new;
  end if;

  base_date := coalesce(new.due_date, (now() at time zone 'America/Sao_Paulo')::date);
  next_due := case new.recurrence_unit
    when 'day' then base_date + new.recurrence_interval
    when 'week' then base_date + (new.recurrence_interval * 7)
    when 'month' then (base_date + make_interval(months => new.recurrence_interval))::date
  end;

  if next_due <= new.recurrence_until then
    insert into public.tasks (
      user_id, title, status, due_date, recurrence_unit, recurrence_interval,
      recurrence_until, recurrence_series_id, recurrence_occurrence
    ) values (
      new.user_id, new.title, 'open', next_due, new.recurrence_unit,
      new.recurrence_interval, new.recurrence_until, new.recurrence_series_id,
      new.recurrence_occurrence + 1
    ) on conflict (recurrence_series_id, recurrence_occurrence)
      where recurrence_series_id is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_create_next_recurrence on public.tasks;
create trigger tasks_create_next_recurrence
after update of status on public.tasks
for each row execute function public.create_next_recurring_task();

revoke all on function public.prepare_task_recurrence() from public, anon, authenticated;
revoke all on function public.create_next_recurring_task() from public, anon, authenticated;
