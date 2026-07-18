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
  it('grupo vê apenas memórias compartilhadas do casal', () =>
    expect(subjectsForChat(grupo)).toEqual(['casal']));
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

  it('instrui estilo: sem ids na resposta, sem ofertas extras, uma pergunta por vez', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('nunca mostre ids');
    expect(p).toContain('uma pergunta por vez');
    expect(p).toContain('não termine oferecendo');
  });

  it('menciona finanças e as tools de finanças', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('finance_month_summary');
    expect(p).toContain('finanças');
  });

  it('instrui sobre códigos de revisão e classificação', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('a001');
  });

  it('orienta os fluxos de viagem e pedidos de oração', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('nome da viagem e a data são obrigatórios');
    expect(p).toContain('pedido de oração sempre precisa do nome da pessoa e do pedido');
    expect(p).toContain('nunca adicione, remova ou liste pelo bot os pedidos individuais do cônjuge');
  });

  it('só conduz o fluxo de recorrência quando o usuário mencionar', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('nunca pergunte se uma tarefa é recorrente');
    expect(p).toContain('primeiro a frequência e depois a data até quando');
    expect(p).toContain('só use tasks_add para uma tarefa recorrente');
    expect(p).toContain('afazeres domésticos são tarefas');
    expect(p).toContain('mesmo quando a pessoa informa um horário');
    expect(p).toContain('nunca crie um evento único e o descreva como recorrente');
  });

  it('não expõe finanças nem segundo cérebro no privado da esposa ou no grupo', () => {
    const wifePrompt = buildSystemPrompt({ ...args, identity: esposa, memories: [] }).toLowerCase();
    const groupPrompt = buildSystemPrompt({ ...args, identity: grupo, memories: [] }).toLowerCase();
    for (const prompt of [wifePrompt, groupPrompt]) {
      expect(prompt).not.toContain('finance_month_summary');
      expect(prompt).not.toContain('knowledge_save');
    }
  });
});
