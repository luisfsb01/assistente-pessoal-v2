import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { QueueEvent } from '../db/events.js';
import { runProactiveCycle, type EngineDeps } from './engine.js';

const ev = (id: string): QueueEvent => ({
  id,
  source: 'finance',
  kind: 'atypical_expense',
  dedupeKey: `k${id}`,
  summary: `Evento ${id}`,
  decision: null,
  reason: null,
  target: null,
  status: 'pending',
  createdAt: '2026-07-14T12:00:00Z',
});

type Resolved = { id: string; status: string; reason: string };

function deps(over: Partial<EngineDeps> = {}): EngineDeps & { resolved: Resolved[]; notified: string[] } {
  const resolved: Resolved[] = [];
  const notified: string[] = [];
  const d = {
    resolved,
    notified,
    collectors: {},
    listPendingEvents: async () => [],
    judgeEvents: async (events: QueueEvent[]) =>
      events.map((e) => ({ id: e.id, decision: 'notify' as const, target: 'luis' as const, reason: 'urgente' })),
    resolveEvent: async (id: string, r: { status: string; reason: string }) => void resolved.push({ id, status: r.status, reason: r.reason }),
    markNotified: async (id: string) => void notified.push(id),
    countNotifiedSince: async () => 0,
    getSubjectChatId: async () => 111,
    getGroupChatId: async () => 999,
    config: async () => ({ quietStart: '22:00', quietEnd: '07:00', maxNotificationsPerDay: 5 }),
    nowLocalHHMM: () => '14:00',
    dayStartIso: () => '2026-07-14T00:00:00-03:00',
    ...over,
  };
  return d as never;
}

describe('runProactiveCycle', () => {
  it('notify fora do silêncio: envia, marca notified', async () => {
    const sent: Array<[number, string]> = [];
    const d = deps({ listPendingEvents: async () => [ev('e1')] });
    const out = await runProactiveCycle([], async (chatId, text) => void sent.push([chatId, text]), d);
    expect(sent).toEqual([[111, '🔔 Evento e1']]);
    expect(d.notified).toEqual(['e1']);
    expect(out.notified).toBe(1);
  });

  it('horário de silêncio rebaixa para queued com motivo', async () => {
    const sent: unknown[] = [];
    const d = deps({ listPendingEvents: async () => [ev('e1')], nowLocalHHMM: () => '23:00' });
    await runProactiveCycle([], async (...a) => void sent.push(a), d);
    expect(sent).toEqual([]);
    expect(d.resolved[0].status).toBe('queued');
    expect(d.resolved[0].reason).toContain('silêncio');
  });

  it('teto diário rebaixa para queued', async () => {
    const d = deps({ listPendingEvents: async () => [ev('e1')], countNotifiedSince: async () => 5 });
    await runProactiveCycle([], async () => {}, d);
    expect(d.resolved[0].status).toBe('queued');
    expect(d.resolved[0].reason).toContain('teto');
  });

  it('briefing e ignore só resolvem status', async () => {
    const d = deps({
      listPendingEvents: async () => [ev('e1'), ev('e2')],
      judgeEvents: async () => [
        { id: 'e1', decision: 'briefing', target: 'esposa', reason: 'informativo' },
        { id: 'e2', decision: 'ignore', target: 'luis', reason: 'trivial' },
      ],
    });
    await runProactiveCycle([], async () => {}, d);
    expect(d.resolved).toEqual([
      { id: 'e1', status: 'queued', reason: 'informativo' },
      { id: 'e2', status: 'ignored', reason: 'trivial' },
    ]);
  });

  it('falha no envio deixa o evento queued (não perde)', async () => {
    const d = deps({ listPendingEvents: async () => [ev('e1')] });
    await runProactiveCycle(
      [],
      async () => {
        throw new Error('telegram fora');
      },
      d,
    );
    expect(d.notified).toEqual([]);
    expect(d.resolved[0].status).toBe('queued');
  });

  it('roda só os coletores pedidos', async () => {
    const ran: string[] = [];
    const d = deps({
      collectors: {
        finance: async () => {
          ran.push('finance');
          return 2;
        },
        tasks: async () => {
          ran.push('tasks');
          return 1;
        },
      },
    });
    const out = await runProactiveCycle(['finance'], async () => {}, d);
    expect(ran).toEqual(['finance']);
    expect(out.collected).toBe(2);
  });
});
