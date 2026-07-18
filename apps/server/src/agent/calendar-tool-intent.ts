import type { ConversationMessage } from './task-recurrence-flow.js';

const EXPLICIT_CALENDAR_TERM =
  /\b(?:calend[aá]rio|agenda|agendar|agende|agendamento|evento|compromisso)s?\b/i;
const NEGATED_CALENDAR =
  /\b(?:n[aã]o|sem)\b[^.!?\n]{0,60}\b(?:calend[aá]rio|agenda|agendar|agende|agendamento|evento|compromisso)s?\b/i;
const CALENDAR_FLOW_COMPLETED =
  /\b(?:evento|compromisso|agendamento)\b[^\n]{0,160}\b(?:criado|agendado|adicionado|atualizado|exclu[ií]do|removido)\b/i;

function isExplicitCalendarRequest(content: string): boolean {
  return EXPLICIT_CALENDAR_TERM.test(content) && !NEGATED_CALENDAR.test(content);
}

/**
 * Libera as tools de calendário somente para um pedido explícito ou para a
 * resposta imediata a uma pergunta necessária desse mesmo fluxo.
 */
export function calendarToolIntent(messages: ConversationMessage[]): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return false;

  const current = messages[lastUserIndex];
  if (NEGATED_CALENDAR.test(current.content)) return false;
  if (isExplicitCalendarRequest(current.content)) return true;

  let start = -1;
  for (let index = lastUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && isExplicitCalendarRequest(message.content)) {
      start = index;
      break;
    }
  }
  if (start < 0) return false;

  const segment = messages.slice(start, lastUserIndex);
  if (
    segment.some(
      (message) => message.role === 'assistant' && CALENDAR_FLOW_COMPLETED.test(message.content),
    )
  )
    return false;

  const previous = messages[lastUserIndex - 1];
  return previous?.role === 'assistant' && previous.content.includes('?');
}
