import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { buildBriefingPrompt, isEmptyBriefing, runDailyBriefing, type BriefingContext, type BriefingDeps } from './briefing.js';

const baseCtx: BriefingContext = {
  name: 'Luis',
  date: '2026-07-15',
  agenda: [{ id: 'e1', title: 'Dentista', start: '2026-07-15T10:00:00-03:00', end: '2026-07-15T11:00:00-03:00', allDay: false }],
  tasks: [{ id: 't1', title: 'Pagar boleto', status: 'open', dueDate: '2026-07-15' }],
  queued: ['Gasto atípico: X — R$ 950,00 em 14/07'],
  commitmentsToday: [{ id: 'c1', description: 'Internet', amount: 120, day_of_month: 15, active: true }],
  finance: { month: '2026-07', income: 5000, expense: 2000, invested: 0, balance: 3000, pending_review: 3, by_category: [{ category: 'Casa', spent: 800, target: 1000 }] },
};

describe('buildBriefingPrompt', () => {
  it('inclui agenda, tarefas, eventos guardados, compromissos e finanças', () => {
    const p = buildBriefingPrompt(baseCtx);
    expect(p).toContain('Dentista');
    expect(p).toContain('10:00');
    expect(p).toContain('Pagar boleto');
    expect(p).toContain('R$ 950,00');
    expect(p).toContain('Internet');
    expect(p).toContain('R$ 2000,00'); // despesa do mês via formatBrl
    expect(p).toContain('Casa');
  });
  it('sem finanças, não inclui bloco financeiro', () => {
    const p = buildBriefingPrompt({ ...baseCtx, finance: null });
    expect(p).not.toContain('Situação do mês');
  });
});

describe('isEmptyBriefing', () => {
  it('vazio quando não há nada a dizer', () => {
    expect(
      isEmptyBriefing({ name: 'Esposa', date: '2026-07-15', agenda: [], tasks: [], queued: [], commitmentsToday: [], finance: null }),
    ).toBe(true);
    expect(isEmptyBriefing(baseCtx)).toBe(false);
  });
});

describe('runDailyBriefing', () => {
  function deps(over: Partial<BriefingDeps> = {}): BriefingDeps & { briefed: string[][] } {
    const briefed: string[][] = [];
    return {
      briefed,
      getUserBySubject: async (s) =>
        ({ id: s === 'luis' ? 'u1' : 'u2', name: s === 'luis' ? 'Luis' : 'Esposa', calendarId: null, telegramChatId: 0 }) as never,
      getSubjectChatId: async (s) => (s === 'luis' ? 111 : 222),
      getGroupChatId: async () => 999,
      listAgenda: async () => [],
      listTasks: async () => [],
      listCommitments: async () => [],
      listQueuedForTarget: async () => [],
      markBriefed: async (ids: string[]) => void briefed.push(ids),
      monthSummary: async () => baseCtx.finance!,
      generate: async () => 'Bom dia! Resumo do dia…',
      todayIso: () => '2026-07-15',
      ...over,
    } as never;
  }

  it('Luis sempre recebe; esposa vazia é pulada; eventos usados viram briefed', async () => {
    const sent: Array<[number, string]> = [];
    const d = deps({
      listQueuedForTarget: async (t) =>
        t === 'luis'
          ? ([{ id: 'q1', summary: 'Gasto atípico', status: 'queued' }] as never)
          : ([] as never),
    });
    await runDailyBriefing(async (chatId, text) => void sent.push([chatId, text]), d);
    expect(sent).toEqual([[111, 'Bom dia! Resumo do dia…']]);
    expect(d.briefed).toEqual([['q1']]);
  });

  it('falha na geração de um não impede o outro', async () => {
    const sent: number[] = [];
    let call = 0;
    const d = deps({
      listQueuedForTarget: async () => [{ id: 'q1', summary: 'x', status: 'queued' }] as never, // ambos têm conteúdo
      monthSummary: async () => baseCtx.finance!,
      generate: async () => {
        call++;
        if (call === 1) throw new Error('boom');
        return 'Bom dia!';
      },
    });
    await runDailyBriefing(async (chatId) => void sent.push(chatId), d);
    expect(sent).toEqual([222]); // luis falhou, esposa recebeu
  });
});
