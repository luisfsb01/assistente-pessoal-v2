import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import type { ChatRole } from '../db/messages.js';
import { handleMessage, type AgentDeps } from './agent.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function makeDeps(identity: ChatIdentity | null) {
  const saved: { chatId: number; role: ChatRole; content: string }[] = [];
  const buildToolsCalls: ChatIdentity[] = [];
  const deps: AgentDeps = {
    getChatIdentity: async () => identity,
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
  return { deps, saved, buildToolsCalls };
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

  it('chama buildTools com a identidade resolvida do chat', async () => {
    const { deps, buildToolsCalls } = makeDeps(luis);
    await handleMessage({ chatId: 1, text: 'qual meu nome?' }, deps);
    expect(buildToolsCalls).toEqual([luis]);
  });
});
