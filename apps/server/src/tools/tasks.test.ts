import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildTaskTools, type TaskToolDeps } from './tasks.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const deps: TaskToolDeps = {
    getUserBySubject: async (s) => ({ id: `uid-${s}`, name: s, calendarId: null }),
    listTasks: async (uid) => {
      calls.push(`list:${uid}`);
      return [
        {
          id: 't1',
          title: 'Pagar boleto',
          status: 'open',
          dueDate: '2026-07-15',
          recurrence: null,
        },
      ];
    },
    addTask: async (uid, title, due, recurrence) => {
      calls.push(`add:${uid}:${title}:${due ?? '-'}:${recurrence ? JSON.stringify(recurrence) : '-'}`);
      return {
        id: 't2',
        title,
        status: 'open',
        dueDate: due ?? null,
        recurrence: recurrence ?? null,
      };
    },
    completeTask: async (id) => {
      calls.push(`done:${id}`);
    },
    updateTask: async (id, patch) => {
      calls.push(`upd:${id}:${JSON.stringify(patch)}`);
    },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildTaskTools', () => {
  it('privado: owner default é o dono do chat', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_add', { title: 'Comprar ração' });
    expect(calls).toEqual(['add:uid-luis:Comprar ração:-:-']);
    expect(out).toContain('Comprar ração');
  });

  it('cria recorrência somente quando ela é enviada completa', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_add', {
      title: 'Tomar remédio',
      due_date: '2026-07-20',
      recurrence: { unit: 'day', interval: 2, until_date: '2026-08-20' },
    });
    expect(calls).toEqual([
      'add:uid-luis:Tomar remédio:2026-07-20:{"unit":"day","interval":2,"untilDate":"2026-08-20"}',
    ]);
    expect(out).toContain('recorrente até 2026-08-20');
  });

  it('rejeita data final anterior ao prazo inicial', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_add', {
      title: 'Tomar remédio',
      due_date: '2026-08-20',
      recurrence: { unit: 'day', interval: 1, until_date: '2026-07-20' },
    });
    expect(calls).toEqual([]);
    expect(out).toContain('não pode ser anterior');
  });

  it('não persiste enquanto faltar a data final na conversa recorrente', async () => {
    const { deps, calls } = makeDeps();
    const tools = buildTaskTools(luis, deps, {
      explicit: true,
      frequencyProvided: true,
      untilDateProvided: false,
    });

    const out = await exec(tools, 'tasks_add', {
      title: 'Retirar o lixo reciclável',
      recurrence: { unit: 'week', interval: 1, until_date: '2027-01-01' },
    });

    expect(calls).toEqual([]);
    expect(out).toContain('até qual data');
  });

  it('não permite omitir recurrence depois que o fluxo recorrente está completo', async () => {
    const { deps, calls } = makeDeps();
    const tools = buildTaskTools(luis, deps, {
      explicit: true,
      frequencyProvided: true,
      untilDateProvided: true,
    });

    const out = await exec(tools, 'tasks_add', { title: 'Retirar o lixo reciclável' });

    expect(calls).toEqual([]);
    expect(out).toContain('Não a crie sem preencher recurrence');
  });

  it('grupo sem owner: pede para especificar', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', {});
    expect(calls).toEqual([]);
    expect(out.toLowerCase()).toContain('de quem');
  });

  it('grupo com owner explícito funciona', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', { owner: 'esposa' });
    expect(calls).toEqual(['list:uid-esposa']);
    expect(out).toContain('Pagar boleto');
  });

  it('erro de banco ao resolver owner no privado vira FAIL, não ASK_OWNER', async () => {
    const { deps } = makeDeps();
    deps.getUserBySubject = async () => {
      throw new Error('db down');
    };
    const out = await exec(buildTaskTools(luis, deps), 'tasks_list', {});
    expect(out.toLowerCase()).toContain('não consegui');
    expect(out.toLowerCase()).not.toContain('de quem');
  });

  it('erro do repo vira mensagem amigável', async () => {
    const { deps } = makeDeps();
    deps.listTasks = async () => {
      throw new Error('boom');
    };
    const out = await exec(buildTaskTools(luis, deps), 'tasks_list', {});
    expect(out.toLowerCase()).toContain('não consegui');
  });

  it('tasks_update sem title nem due_date: não chama o repo, retorna aviso', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_update', { task_id: 't1' });
    expect(calls).toEqual([]);
    expect(out).toBe('Nada para atualizar — informe título e/ou prazo.');
  });
});
