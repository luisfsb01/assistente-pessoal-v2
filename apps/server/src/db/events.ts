import { supabase } from './client.js';

export type EventSource = 'finance' | 'calendar' | 'tasks' | 'gmail' | 'projects';
export type EventDecision = 'notify' | 'briefing' | 'ignore';
export type EventTarget = 'luis' | 'esposa' | 'grupo';
export type EventStatus = 'pending' | 'ignored' | 'queued' | 'notified' | 'briefed';
export type EventResolution = { decision: EventDecision; reason: string; target: EventTarget; status: EventStatus };

export type QueueEvent = {
  id: string;
  source: EventSource;
  kind: string;
  dedupeKey: string;
  summary: string;
  decision: EventDecision | null;
  reason: string | null;
  target: EventTarget | null;
  status: EventStatus;
  createdAt: string;
};

const COLS = 'id, source, kind, dedupe_key, summary, decision, reason, target, status, created_at';

function toEvent(r: Record<string, unknown>): QueueEvent {
  return {
    id: r.id as string,
    source: r.source as EventSource,
    kind: r.kind as string,
    dedupeKey: r.dedupe_key as string,
    summary: r.summary as string,
    decision: (r.decision as EventDecision | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    target: (r.target as EventTarget | null) ?? null,
    status: r.status as EventStatus,
    createdAt: r.created_at as string,
  };
}

/** Insere um evento; retorna null se o dedupe_key já existia (evento repetido).
 *  Com `resolution`, o evento já nasce decidido (auditoria sem passar pelo julgamento). */
export async function insertEvent(e: {
  source: EventSource;
  kind: string;
  dedupeKey: string;
  summary: string;
  payload?: unknown;
  resolution?: EventResolution;
}): Promise<QueueEvent | null> {
  const r = e.resolution;
  const { data, error } = await supabase
    .from('event_queue')
    .upsert(
      {
        source: e.source,
        kind: e.kind,
        dedupe_key: e.dedupeKey,
        summary: e.summary,
        payload: e.payload ?? null,
        ...(r
          ? { decision: r.decision, reason: r.reason, target: r.target, status: r.status, decided_at: new Date().toISOString() }
          : {}),
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select(COLS);
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? toEvent(row) : null;
}

export async function listPendingEvents(): Promise<QueueEvent[]> {
  const { data, error } = await supabase
    .from('event_queue')
    .select(COLS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

/** Grava a decisão do julgamento (auditável) e o status resultante. */
export async function resolveEvent(id: string, r: EventResolution): Promise<void> {
  const { error } = await supabase
    .from('event_queue')
    .update({ decision: r.decision, reason: r.reason, target: r.target, status: r.status, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markNotified(id: string): Promise<void> {
  const { error } = await supabase
    .from('event_queue')
    .update({ status: 'notified', delivered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function listQueuedForTarget(target: EventTarget): Promise<QueueEvent[]> {
  const { data, error } = await supabase
    .from('event_queue')
    .select(COLS)
    .eq('status', 'queued')
    .eq('target', target)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

export async function markBriefed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('event_queue')
    .update({ status: 'briefed', delivered_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}

/** Quantas notificações já foram entregues para um destino desde um instante (teto diário). */
export async function countNotifiedSince(sinceIso: string, target: EventTarget): Promise<number> {
  const { count, error } = await supabase
    .from('event_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'notified')
    .eq('target', target)
    .gte('delivered_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** Eventos de um kind desde um instante (relatório da limpeza no briefing). */
export async function listEventsByKindSince(
  kind: string,
  sinceIso: string,
): Promise<Array<{ summary: string; reason: string | null }>> {
  const { data, error } = await supabase
    .from('event_queue')
    .select('summary, reason')
    .eq('kind', kind)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ summary: r.summary as string, reason: (r.reason as string | null) ?? null }));
}
