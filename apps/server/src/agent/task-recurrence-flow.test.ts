import { describe, expect, it } from 'vitest';
import { nextTaskRecurrenceQuestion, taskRecurrenceFlow } from './task-recurrence-flow.js';

describe('taskRecurrenceFlow', () => {
  it('reconhece o caso real com dia da semana e exige diretamente a data final', () => {
    const flow = taskRecurrenceFlow([
      { role: 'user', content: 'Retirar o lixo reciclável toda quarta-feira às 21 hrs' },
    ]);

    expect(flow).toEqual({
      explicit: true,
      frequencyProvided: true,
      untilDateProvided: false,
    });
    expect(nextTaskRecurrenceQuestion(flow)).toBe(
      'Até qual data devo manter essa tarefa recorrente?',
    );
  });

  it('pede primeiro a frequência quando só foi dito que é recorrente', () => {
    const flow = taskRecurrenceFlow([
      { role: 'user', content: 'Crie uma tarefa recorrente para revisar o orçamento' },
    ]);

    expect(nextTaskRecurrenceQuestion(flow)).toBe('Qual é a frequência da tarefa recorrente?');
  });

  it('reconhece frequência e data respondidas em duas etapas', () => {
    const flow = taskRecurrenceFlow([
      { role: 'user', content: 'Crie uma tarefa recorrente para revisar o orçamento' },
      { role: 'assistant', content: 'Qual é a frequência da tarefa recorrente?' },
      { role: 'user', content: 'Toda semana' },
      { role: 'assistant', content: 'Até qual data devo manter essa tarefa recorrente?' },
      { role: 'user', content: 'Até 31/12/2026' },
    ]);

    expect(flow).toEqual({
      explicit: true,
      frequencyProvided: true,
      untilDateProvided: true,
    });
    expect(nextTaskRecurrenceQuestion(flow)).toBeNull();
  });

  it('não ativa o fluxo quando o usuário nega recorrência', () => {
    const flow = taskRecurrenceFlow([
      { role: 'user', content: 'Crie uma tarefa, não é recorrente' },
    ]);

    expect(flow.explicit).toBe(false);
    expect(nextTaskRecurrenceQuestion(flow)).toBeNull();
  });

  it('encerra um fluxo legado depois da confirmação de evento criado', () => {
    const flow = taskRecurrenceFlow([
      { role: 'user', content: 'Retirar o lixo reciclável toda quarta-feira às 21 hrs' },
      {
        role: 'assistant',
        content: 'Quer que eu crie um evento recorrente toda quarta-feira às 21h?',
      },
      { role: 'user', content: 'sim' },
      {
        role: 'assistant',
        content: 'Evento "Retirar lixo reciclável (recorrente: quartas-feiras)" criado para Luis.',
      },
      { role: 'user', content: 'Crie uma tarefa para comprar sacos de lixo' },
    ]);

    expect(flow.explicit).toBe(false);
  });
});
