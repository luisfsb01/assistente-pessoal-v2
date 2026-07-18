import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildEmailCleanupTools, type EmailCleanupToolDeps } from './email-cleanup.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };

async function execute(identity: ChatIdentity, deps: EmailCleanupToolDeps) {
  const entry = buildEmailCleanupTools(identity, deps).email_cleanup_protect as unknown as {
    execute: (input: unknown, options: unknown) => Promise<string>;
  };
  return entry.execute(
    { match_on: 'domain', match_value: 'colegio.com.br', description: 'E-mails da escola' },
    { toolCallId: 't1', messages: [] },
  );
}

describe('email_cleanup_protect', () => {
  it('salva uma proteção persistente para o Luis', async () => {
    const calls: unknown[] = [];
    const deps: EmailCleanupToolDeps = {
      getUserBySubject: async () => ({ id: 'u1', name: 'Luis', calendarId: null }),
      addProtection: async (input) => {
        calls.push(input);
        return { id: 'p1', matchOn: input.matchOn, matchValue: input.matchValue, description: input.description ?? null };
      },
    };
    const result = await execute(luis, deps);
    expect(calls).toEqual([
      {
        userId: 'u1',
        matchOn: 'domain',
        matchValue: 'colegio.com.br',
        description: 'E-mails da escola',
      },
    ]);
    expect(result).toContain('não serão enviados à lixeira');
  });

  it('recusa configuração fora do privado do Luis', async () => {
    let called = false;
    const deps: EmailCleanupToolDeps = {
      getUserBySubject: async () => null,
      addProtection: async () => {
        called = true;
        throw new Error('não deveria chamar');
      },
    };
    expect(await execute(esposa, deps)).toContain('chat privado do Luis');
    expect(called).toBe(false);
  });
});
