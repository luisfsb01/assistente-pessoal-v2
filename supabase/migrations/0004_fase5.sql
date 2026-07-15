-- Fase 5: e-mails entram na fila de eventos (source 'gmail')
alter table event_queue drop constraint event_queue_source_check;
alter table event_queue add constraint event_queue_source_check
  check (source in ('finance','calendar','tasks','gmail'));
