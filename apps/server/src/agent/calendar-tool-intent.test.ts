import { describe, expect, it } from 'vitest';
import { calendarToolIntent } from './calendar-tool-intent.js';

describe('calendarToolIntent', () => {
  it('não expõe calendário para tarefa recorrente com dia e horário', () => {
    expect(
      calendarToolIntent([
        {
          role: 'user',
          content: 'Crie uma tarefa recorrente para retirar o lixo toda quarta-feira às 21h',
        },
      ]),
    ).toBe(false);
  });

  it('não expõe calendário para mensagem normal sem intenção de agenda', () => {
    expect(
      calendarToolIntent([{ role: 'user', content: 'Crie uma tarefa para comprar ração amanhã' }]),
    ).toBe(false);
  });

  it('expõe calendário quando o usuário manda adicionar no calendário', () => {
    expect(
      calendarToolIntent([
        { role: 'user', content: 'Adicione no calendário a consulta de amanhã às 15h' },
      ]),
    ).toBe(true);
  });

  it.each(['compromisso', 'evento', 'agenda'])(
    'expõe calendário quando o pedido menciona %s explicitamente',
    (term) => {
      expect(
        calendarToolIntent([{ role: 'user', content: `Crie um ${term} amanhã às 15h` }]),
      ).toBe(true);
    },
  );

  it('mantém calendário no retorno imediato com um detalhe solicitado', () => {
    expect(
      calendarToolIntent([
        { role: 'user', content: 'Adicione uma consulta na agenda amanhã' },
        { role: 'assistant', content: 'Qual é o horário da consulta?' },
        { role: 'user', content: 'Às 15h' },
      ]),
    ).toBe(true);
  });

  it('respeita pedido explícito para não adicionar ao calendário', () => {
    expect(
      calendarToolIntent([
        { role: 'user', content: 'Não coloque no calendário; crie apenas uma tarefa às 15h' },
      ]),
    ).toBe(false);
  });
});
