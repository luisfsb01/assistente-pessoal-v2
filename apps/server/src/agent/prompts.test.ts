import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildSystemPrompt, subjectsForChat } from './prompts.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

describe('subjectsForChat', () => {
  it('privado do Luis vê luis + casal', () =>
    expect(subjectsForChat(luis)).toEqual(['luis', 'casal']));
  it('privado da esposa vê esposa + casal', () =>
    expect(subjectsForChat(esposa)).toEqual(['esposa', 'casal']));
  it('grupo vê tudo', () =>
    expect(subjectsForChat(grupo)).toEqual(['luis', 'esposa', 'casal']));
});

describe('buildSystemPrompt', () => {
  const args = {
    identity: luis,
    memories: [{ id: 'm1', subject: 'luis' as const, type: 'preference' as const, content: 'Prefere reuniões à tarde' }],
    now: new Date('2026-07-08T12:00:00Z'),
    timezone: 'America/Sao_Paulo',
    hasCalendar: true,
  };

  it('inclui nome do usuário, memórias e data', () => {
    const p = buildSystemPrompt(args);
    expect(p).toContain('Luis');
    expect(p).toContain('Prefere reuniões à tarde');
    expect(p).toContain('2026');
  });

  it('no grupo, instrui a distinguir quem fala', () => {
    const p = buildSystemPrompt({ ...args, identity: grupo, memories: [] });
    expect(p.toLowerCase()).toContain('grupo');
  });

  it('sem memórias, não inclui bloco vazio de memórias', () => {
    const p = buildSystemPrompt({ ...args, memories: [] });
    expect(p).not.toContain('O que você sabe');
  });

  it('no privado, menciona tarefas e agenda', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('tarefas');
    expect(p).toContain('agenda');
  });

  it('no grupo, menciona lista de compras', () => {
    const p = buildSystemPrompt({ ...args, identity: grupo, memories: [] }).toLowerCase();
    expect(p).toContain('lista de compras');
  });

  it('sem calendário configurado, não menciona tools calendar_', () => {
    const p = buildSystemPrompt({ ...args, hasCalendar: false }).toLowerCase();
    expect(p).not.toContain('calendar_');
  });
});
