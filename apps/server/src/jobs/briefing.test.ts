import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import {
  buildBriefingTaskButtons,
  formatDailyBriefing,
  isEmptyBriefing,
  runCoupleBriefing,
  runDailyBriefing,
  type BriefingContext,
  type BriefingDeps,
} from './briefing.js';

const baseCtx: BriefingContext = {
  name: 'Luis',
  date: '2026-07-15',
  agenda: [
    {
      id: 'e1',
      title: 'Dentista',
      start: '2026-07-15T10:00:00-03:00',
      end: '2026-07-15T11:00:00-03:00',
      allDay: false,
    },
  ],
  tasks: [{ id: 't1', title: 'Pagar boleto', status: 'open', dueDate: '2026-07-15', recurrence: null }],
  projectActions: [
    {
      id: 'pt1',
      projectId: 'p1',
      projectName: 'Site',
      title: 'Revisar página inicial',
      status: 'doing',
      dueDate: '2026-07-15',
    },
  ],
  commitmentsToday: [
    { id: 'c1', description: 'Internet', amount: 120, day_of_month: 15, active: true },
  ],
  habits: [{ name: 'Academia', done: 1, target: 3 }],
};

describe('formatDailyBriefing', () => {
  it('traz somente compromissos, tarefas, ações de projetos e hábitos em tópicos', () => {
    const text = formatDailyBriefing(baseCtx);
    expect(text).toContain('☀️ BOM DIA, LUIS — 15/07');
    expect(text).toContain('📅 COMPROMISSOS\n• Dentista às 10:00');
    expect(text).toContain('✅ TAREFAS\n• Pagar boleto');
    expect(text).toContain('📁 PROJETOS\n• Site: Revisar página inicial');
    expect(text).toContain('💳 COMPROMISSOS FINANCEIROS\n• Internet — R$ 120,00');
    expect(text).toContain('🔁 HÁBITOS\n• Academia: 1/3 nesta semana');
  });

  it('não inclui finanças gerais, e-mail, insights ou ação sugerida', () => {
    const text = formatDailyBriefing(baseCtx);
    expect(text).not.toContain('FINANÇAS');
    expect(text).not.toContain('E-MAIL');
    expect(text).not.toContain('AÇÃO DE HOJE');
    expect(text).not.toContain('Vale retomar');
  });
});

describe('buildBriefingTaskButtons', () => {
  it('no Hermes inclui feito/não feito com referências curtas', () => {
    const kb = buildBriefingTaskButtons(baseCtx, 'hermes');
    expect(kb).toMatchObject({
      keyboard: [
        [{ text: '✅ Fiz T-T1' }, { text: '❌ Não fiz T-T1' }],
        [{ text: '✅ Fiz P-PT1' }, { text: '❌ Não fiz P-PT1' }],
      ],
    });
  });

  it('no bot nativo mantém callbacks inline', () => {
    const kb = buildBriefingTaskButtons(baseCtx, 'buttons');
    expect(kb).toMatchObject({ inline_keyboard: expect.any(Array) });
  });
});

describe('isEmptyBriefing', () => {
  it('considera apenas as fontes permitidas', () => {
    expect(
      isEmptyBriefing({
        name: 'Esposa',
        date: '2026-07-15',
        agenda: [],
        tasks: [],
        projectActions: [],
        commitmentsToday: [],
        habits: null,
      }),
    ).toBe(true);
    expect(isEmptyBriefing(baseCtx)).toBe(false);
  });
});

describe('runDailyBriefing', () => {
  function deps(over: Partial<BriefingDeps> = {}): BriefingDeps & { briefed: string[][] } {
    const briefed: string[][] = [];
    return {
      briefed,
      getUserBySubject: async (subject) =>
        ({
          id: subject === 'luis' ? 'u1' : 'u2',
          name: subject === 'luis' ? 'Luis' : 'Esposa',
          calendarId: null,
          telegramChatId: 0,
        }) as never,
      getSubjectChatId: async (subject) => (subject === 'luis' ? 111 : 222),
      getGroupChatId: async () => 999,
      listAgenda: async () => [],
      listTasks: async () => [],
      listProjectTasksDueOn: async () => [],
      listCommitments: async () => [],
      listQueuedForTarget: async () => [],
      listActiveHabits: async () => [],
      listHabitCheckins: async () => [],
      markBriefed: async (ids: string[]) => void briefed.push(ids),
      todayIso: () => '2026-07-15',
      ...over,
    } as never;
  }

  it('inclui tarefas abertas com prazo até hoje, mas não futuras', async () => {
    const sent: Array<[number, string, boolean]> = [];
    const d = deps({
      listTasks: async (userId) =>
        userId === 'u1'
          ? ([
              { id: 'old', title: 'Atrasada', status: 'open', dueDate: '2026-07-14', recurrence: null },
              { id: 'today', title: 'De hoje', status: 'open', dueDate: '2026-07-15', recurrence: null },
              { id: 'future', title: 'Futura', status: 'open', dueDate: '2026-07-16', recurrence: null },
            ] as never)
          : [],
    });
    await runDailyBriefing(async (chatId, text, kb) => void sent.push([chatId, text, kb !== undefined]), d, 'hermes');
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toContain('Atrasada');
    expect(sent[0][1]).toContain('De hoje');
    expect(sent[0][1]).not.toContain('Futura');
    expect(sent[0][2]).toBe(true);
  });

  it('inclui ações de projetos com a data do dia', async () => {
    const sent: string[] = [];
    const d = deps({
      listProjectTasksDueOn: async (userId) =>
        userId === 'u1'
          ? ([
              {
                id: 'pt1',
                projectId: 'p1',
                projectName: 'Site',
                title: 'Publicar revisão',
                status: 'todo',
                dueDate: '2026-07-15',
              },
            ] as never)
          : [],
    });
    await runDailyBriefing(async (_chatId, text) => void sent.push(text), d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('📁 PROJETOS\n• Site: Publicar revisão');
  });

  it('eventos antigos da fila são drenados sem aparecer no briefing', async () => {
    const sent: string[] = [];
    const d = deps({
      listQueuedForTarget: async (target) =>
        target === 'luis' ? ([{ id: 'q1', summary: 'Gasto atípico', status: 'queued' }] as never) : [],
      listTasks: async (userId) =>
        userId === 'u1'
          ? ([{ id: 't1', title: 'Tarefa do dia', status: 'open', dueDate: '2026-07-15', recurrence: null }] as never)
          : [],
    });
    await runDailyBriefing(async (_chatId, text) => void sent.push(text), d);
    expect(sent[0]).not.toContain('Gasto atípico');
    expect(d.briefed).toContainEqual(['q1']);
  });

  it('hábitos mostram somente progresso, sem comentário motivacional', async () => {
    const sent: string[] = [];
    const d = deps({
      listActiveHabits: async (userId) =>
        userId === 'u1' ? ([{ id: 'h1', name: 'Academia', targetPerWeek: 3 }] as never) : [],
      listHabitCheckins: async () => [{ habitId: 'h1', date: '2026-07-15', done: true }],
    });
    await runDailyBriefing(async (_chatId, text) => void sent.push(text), d);
    expect(sent[0]).toContain('• Academia: 1/3 nesta semana');
    expect(sent[0]).not.toContain('Vale');
  });
});

describe('runCoupleBriefing', () => {
  it('inclui o fim de semana atual e a semana seguinte no consolidado do grupo', async () => {
    const sent: Array<[number, string]> = [];
    const agendaCalls: Array<[string, string, string]> = [];
    const deps: BriefingDeps = {
      getUserBySubject: async (subject) => ({
        id: subject === 'luis' ? 'u1' : 'u2',
        name: subject === 'luis' ? 'Luis' : 'Esposa',
        calendarId: subject === 'luis' ? 'cal-luis' : 'cal-esposa',
      }),
      getSubjectChatId: async () => null,
      getGroupChatId: async () => 999,
      listAgenda: async (calendarId, fromDate, toDate) => {
        agendaCalls.push([calendarId, fromDate, toDate]);
        if (calendarId !== 'cal-luis' || toDate < '2026-08-03') return [];
        return [
          {
            id: 'e1',
            title: 'Compromisso da semana',
            start: '2026-08-03T10:00:00-03:00',
            end: '2026-08-03T11:00:00-03:00',
            allDay: false,
          },
        ];
      },
      listTasks: async () => [],
      listProjectTasksDueOn: async () => [],
      listCommitments: async () => [],
      listQueuedForTarget: async () => [],
      listActiveHabits: async () => [],
      listHabitCheckins: async () => [],
      markBriefed: async () => undefined,
      todayIso: () => '2026-08-01',
    };

    await runCoupleBriefing(async (chatId, text) => void sent.push([chatId, text]), deps);

    expect(agendaCalls).toEqual([
      ['cal-luis', '2026-08-01', '2026-08-09'],
      ['cal-esposa', '2026-08-01', '2026-08-09'],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(999);
    expect(sent[0][1]).toContain('Compromisso da semana (Luis)');
  });
});
