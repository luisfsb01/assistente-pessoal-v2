import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import type { ChatRole } from '../db/messages.js';
import { handleMessage, type AgentDeps } from './agent.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function makeDeps(identity: ChatIdentity | null) {
  const saved: { chatId: number; role: ChatRole; content: string }[] = [];
  const buildToolsCalls: ChatIdentity[] = [];
  const identityCalls: Array<[number, number | undefined]> = [];
  const deps: AgentDeps = {
    getChatIdentity: async (chatId, senderId) => {
      identityCalls.push([chatId, senderId]);
      return identity;
    },
    saveMessage: async (m) => {
      saved.push(m);
    },
    getRecentMessages: async () => [{ role: 'user', content: 'oi' }],
    recall: async () => [],
    generate: async (opts) => {
      // o agente deve mandar system prompt e o histórico + mensagem nova
      expect(opts.system.length).toBeGreaterThan(0);
      expect(opts.messages.at(-1)).toEqual({ role: 'user', content: 'qual meu nome?' });
      return 'Você é o Luis!';
    },
    buildTools: (identity) => {
      buildToolsCalls.push(identity);
      return {};
    },
  };
  return { deps, saved, buildToolsCalls, identityCalls };
}

describe('handleMessage', () => {
  it('retorna null para chat não cadastrado', async () => {
    const { deps } = makeDeps(null);
    expect(await handleMessage({ chatId: 99, text: 'oi' }, deps)).toBeNull();
  });

  it('persiste a mensagem do usuário e a resposta', async () => {
    const { deps, saved } = makeDeps(luis);
    const reply = await handleMessage({ chatId: 1, text: 'qual meu nome?' }, deps);
    expect(reply).toBe('Você é o Luis!');
    expect(saved).toEqual([
      { chatId: 1, role: 'user', content: 'qual meu nome?' },
      { chatId: 1, role: 'assistant', content: 'Você é o Luis!' },
    ]);
  });

  it('não chama o modelo e pergunta a frequência quando a recorrência foi mencionada sem frequência', async () => {
    const { deps, saved } = makeDeps(luis);
    let generated = false;
    deps.getRecentMessages = async () => [];
    deps.generate = async () => {
      generated = true;
      return 'não deveria executar';
    };

    const reply = await handleMessage(
      { chatId: 1, text: 'Crie uma tarefa recorrente para revisar o orçamento' },
      deps,
    );

    expect(generated).toBe(false);
    expect(reply).toBe('Qual é a frequência da tarefa recorrente?');
    expect(saved.at(-1)).toEqual({
      chatId: 1,
      role: 'assistant',
      content: 'Qual é a frequência da tarefa recorrente?',
    });
  });

  it('pergunta obrigatoriamente a data final depois de receber a frequência', async () => {
    const { deps } = makeDeps(luis);
    let generated = false;
    deps.getRecentMessages = async () => [
      { role: 'user', content: 'Crie uma tarefa recorrente para revisar o orçamento' },
      { role: 'assistant', content: 'Qual é a frequência da tarefa recorrente?' },
    ];
    deps.generate = async () => {
      generated = true;
      return 'não deveria executar';
    };

    const reply = await handleMessage({ chatId: 1, text: 'Toda semana' }, deps);

    expect(generated).toBe(false);
    expect(reply).toBe('Até qual data devo manter essa tarefa recorrente?');
  });

  it('só libera o modelo depois que frequência e data final foram informadas', async () => {
    const { deps } = makeDeps(luis);
    const contexts: Parameters<AgentDeps['buildTools']>[1][] = [];
    deps.getRecentMessages = async () => [
      { role: 'user', content: 'Crie uma tarefa recorrente para revisar o orçamento' },
      { role: 'assistant', content: 'Qual é a frequência da tarefa recorrente?' },
      { role: 'user', content: 'Toda semana' },
      { role: 'assistant', content: 'Até qual data devo manter essa tarefa recorrente?' },
    ];
    deps.buildTools = (_identity, context) => {
      contexts.push(context);
      return {};
    };
    deps.generate = async () => 'Tarefa criada.';

    const reply = await handleMessage({ chatId: 1, text: 'Até 31/12/2026' }, deps);

    expect(reply).toBe('Tarefa criada.');
    expect(contexts).toEqual([
      {
        taskRecurrence: {
          explicit: true,
          frequencyProvided: true,
          untilDateProvided: true,
        },
        calendarExplicit: false,
      },
    ]);
  });

  it('chama buildTools com a identidade resolvida do chat', async () => {
    const { deps, buildToolsCalls } = makeDeps(luis);
    await handleMessage({ chatId: 1, text: 'qual meu nome?' }, deps);
    expect(buildToolsCalls).toEqual([luis]);
  });

  it('persiste respostas estruturadas da revisao financeira sem chamar o modelo', async () => {
    const { deps, saved } = makeDeps(luis);
    let generated = false;
    deps.generate = async () => {
      generated = true;
      return 'nao deveria executar';
    };
    deps.handleFinanceReviewReply = async (text) =>
      text === 'A045 - Compras Necessarias' ? 'Pronto — registrei A045.' : null;

    await expect(handleMessage({ chatId: 1, text: 'A045 - Compras Necessarias' }, deps)).resolves.toBe(
      'Pronto — registrei A045.',
    );
    expect(generated).toBe(false);
    expect(saved).toEqual([
      { chatId: 1, role: 'user', content: 'A045 - Compras Necessarias' },
      { chatId: 1, role: 'assistant', content: 'Pronto — registrei A045.' },
    ]);
  });

  it('nao intercepta classificacao financeira em chat sem acesso a financas', async () => {
    const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };
    const { deps } = makeDeps(esposa);
    let intercepted = false;
    deps.handleFinanceReviewReply = async () => {
      intercepted = true;
      return 'nao deveria executar';
    };
    deps.generate = async () => 'Resposta normal.';

    await handleMessage({ chatId: 2, text: 'A045 - Compras Necessarias' }, deps);
    expect(intercepted).toBe(false);
  });

  it('encaminha o senderId para validar o remetente do grupo', async () => {
    const { deps, identityCalls } = makeDeps(luis);
    await handleMessage({ chatId: 1, senderId: 42, text: 'qual meu nome?' }, deps);
    expect(identityCalls).toEqual([[1, 42]]);
  });
});
