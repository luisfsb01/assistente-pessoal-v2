-- Preserva o primeiro prazo atribuído a cada tarefa, mesmo quando o prazo atual muda.
alter table public.tasks
  add column if not exists initial_due_date date;

update public.tasks
set initial_due_date = due_date
where initial_due_date is null and due_date is not null;

create or replace function public.preserve_task_initial_due_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.initial_due_date := new.due_date;
  else
    new.initial_due_date := coalesce(old.initial_due_date, new.due_date);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_preserve_initial_due_date on public.tasks;
create trigger tasks_preserve_initial_due_date
before insert or update of due_date, initial_due_date on public.tasks
for each row execute function public.preserve_task_initial_due_date();

revoke all on function public.preserve_task_initial_due_date() from public, anon, authenticated;
