import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildTools } from './agent.js';
import { capabilitiesForChat } from './capabilities.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

describe('capabilitiesForChat', () => {
  it('finanças e segundo cérebro ficam exclusivos do privado do Luis', () => {
    expect(capabilitiesForChat(luis).has('finance')).toBe(true);
    expect(capabilitiesForChat(luis).has('knowledge')).toBe(true);
    expect(capabilitiesForChat(esposa).has('finance')).toBe(false);
    expect(capabilitiesForChat(esposa).has('knowledge')).toBe(false);
    expect(capabilitiesForChat(grupo).has('finance')).toBe(false);
    expect(capabilitiesForChat(grupo).has('knowledge')).toBe(false);
  });

  it('ToolSet materializa a matriz de autorização', () => {
    expect(Object.keys(buildTools(luis))).toContain('finance_month_summary');
    expect(Object.keys(buildTools(esposa))).not.toContain('finance_month_summary');
    expect(Object.keys(buildTools(grupo))).not.toContain('project_create');
  });

  it('grupo não consegue gravar memória privada', async () => {
    const save = buildTools(grupo).save_memory as unknown as {
      execute: (input: unknown, options: unknown) => Promise<string>;
    };
    const result = await save.execute(
      { subject: 'luis', type: 'fact', content: 'segredo' },
      { toolCallId: 't1', messages: [] },
    );
    expect(result).toContain('Não autorizado');
  });
});
