export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type TaskRecurrenceFlow = {
  explicit: boolean;
  frequencyProvided: boolean;
  untilDateProvided: boolean;
};

const NO_RECURRENCE: TaskRecurrenceFlow = {
  explicit: false,
  frequencyProvided: false,
  untilDateProvided: false,
};

const RECURRENCE_INTENT =
  /\brecorr(?:ente|ência)\b|\brepet(?:ir|e|ição)\b|\b(?:todo|toda|cada)\s+(?:dia|semana|mês|mes|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i;
const RECURRENCE_CANCELLED = /\b(?:não|nao)\s+(?:é|e|será|sera)?\s*recorrente\b|\bcancel(?:a|ar)\s+(?:a\s+)?recorrência\b/i;
const FLOW_COMPLETED =
  /\btarefa\s+(?:foi\s+)?criada\b|\bevento\b[^\n]{0,200}\bcriado\b|\bcriei\s+(?:a\s+|o\s+)?(?:tarefa|evento)\b/i;
const FREQUENCY =
  /\b(?:diári[ao]|diariamente|semanal|semanalmente|quinzenal|quinzenalmente|mensal|mensalmente|anual|anualmente)\b|\b(?:todo|toda)\s+(?:dia|semana|mês|mes|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)s?\b|\b(?:a\s+)?cada\s+\d+\s+(?:dia|semana|mês|mes)(?:s|es)?\b|\b\d+\s+vez(?:es)?\s+por\s+(?:dia|semana|mês|mes)\b/i;
const ASKS_FREQUENCY = /\bqual\s+(?:é\s+|e\s+)?a\s+frequência\b|\bcom\s+que\s+frequência\b/i;
const ASKS_UNTIL = /\baté\s+(?:qual\s+data|quando)\b|\bqual\s+(?:é\s+|e\s+)?a\s+data\s+final\b/i;
const EXPLICIT_UNTIL =
  /\baté\s+(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|o\s+fim\s+d[eo]|fim\s+d[eo]|(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|hoje|amanhã|amanha)\b/i;
const UNTIL_ANSWER =
  /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b|\b(?:fim\s+d[eo]\s+(?:mês|mes|ano)|final\s+d[eo]\s+(?:mês|mes|ano)|hoje|amanhã|amanha)\b|\b(?:por|durante)\s+\d+\s+(?:dia|semana|mês|mes)(?:s|es)?\b/i;

function latestExplicitRecurrenceIndex(messages: ConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'user' &&
      RECURRENCE_INTENT.test(message.content) &&
      !RECURRENCE_CANCELLED.test(message.content)
    )
      return index;
  }
  return -1;
}

export function taskRecurrenceFlow(messages: ConversationMessage[]): TaskRecurrenceFlow {
  const start = latestExplicitRecurrenceIndex(messages);
  if (start < 0) return NO_RECURRENCE;

  const segment = messages.slice(start);
  if (
    segment.some(
      (message, index) =>
        index > 0 &&
        ((message.role === 'assistant' && FLOW_COMPLETED.test(message.content)) ||
          (message.role === 'user' && RECURRENCE_CANCELLED.test(message.content))),
    )
  ) {
    return NO_RECURRENCE;
  }

  let frequencyProvided = false;
  let untilDateProvided = false;
  let waitingForFrequency = false;
  let waitingForUntil = false;

  for (const message of segment) {
    if (message.role === 'assistant') {
      waitingForFrequency = ASKS_FREQUENCY.test(message.content);
      waitingForUntil = ASKS_UNTIL.test(message.content);
      continue;
    }

    if (FREQUENCY.test(message.content)) frequencyProvided = true;
    if (EXPLICIT_UNTIL.test(message.content)) untilDateProvided = true;
    if (waitingForFrequency && FREQUENCY.test(message.content)) frequencyProvided = true;
    if (waitingForUntil && UNTIL_ANSWER.test(message.content)) untilDateProvided = true;
    waitingForFrequency = false;
    waitingForUntil = false;
  }

  return { explicit: true, frequencyProvided, untilDateProvided };
}

export function nextTaskRecurrenceQuestion(flow: TaskRecurrenceFlow): string | null {
  if (!flow.explicit) return null;
  if (!flow.frequencyProvided) return 'Qual é a frequência da tarefa recorrente?';
  if (!flow.untilDateProvided) return 'Até qual data devo manter essa tarefa recorrente?';
  return null;
}
