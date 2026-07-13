import type { ChatIdentity } from '../db/chats.js';
import type { Memory, MemorySubject } from '../db/memories.js';

export function subjectsForChat(identity: ChatIdentity): MemorySubject[] {
  if (identity.kind === 'group') return ['luis', 'esposa', 'casal'];
  if (identity.subject === 'luis') return ['luis', 'casal'];
  return ['esposa', 'casal'];
}

export function buildSystemPrompt(args: {
  identity: ChatIdentity;
  memories: Memory[];
  now: Date;
  timezone: string;
  hasCalendar: boolean;
}): string {
  const { identity, memories, now, timezone, hasCalendar } = args;
  const dateStr = now.toLocaleString('pt-BR', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' });

  const who =
    identity.kind === 'group'
      ? 'Você está no grupo do casal (Luis e esposa). As mensagens vêm prefixadas com o nome de quem fala — responda levando em conta quem pediu.'
      : `Você está no chat privado de ${identity.userName}.`;

  const memoryBlock =
    memories.length > 0
      ? `\n\nO que você sabe (memórias relevantes):\n${memories
          .map((m) => `- [${m.subject}/${m.type}] ${m.content}`)
          .join('\n')}`
      : '';

  const ownerNote =
    identity.kind === 'group'
      ? 'No grupo, sempre que a pessoa não deixar claro de quem é a tarefa/evento/lista, especifique o owner (luis ou esposa) — pergunte se não estiver óbvio pelo contexto ou por quem está falando.'
      : 'No privado, o padrão é que tarefas e agenda são do dono do chat, salvo se a pessoa pedir explicitamente algo do outro.';

  const agendaBullet = hasCalendar
    ? `\n- Agenda: cada pessoa tem sua própria agenda do Google Calendar (tools calendar_list_events, calendar_create_event, calendar_update_event, calendar_delete_event). Resolva datas relativas ("amanhã", "sexta que vem", "semana que vem") usando a data atual acima antes de chamar as tools.`
    : '';

  const capabilities = `

Capacidades:
- Tarefas: cada pessoa tem sua própria lista de tarefas (tools tasks_list, tasks_add, tasks_complete, tasks_update). ${ownerNote}${agendaBullet}
- Lista de compras: uma lista de compras única do casal (tools shopping_list, shopping_add, shopping_remove, shopping_clear) — mora no grupo, mas também está acessível nos chats privados.

Instruções para usar as tools:
- Para concluir ou remover ${hasCalendar ? 'uma tarefa, um evento ou um item' : 'uma tarefa ou um item'}, primeiro liste (${hasCalendar ? 'tasks_list/calendar_list_events/shopping_list' : 'tasks_list/shopping_list'}) para conseguir o id correto — nunca invente um id.
- Antes de chamar ${hasCalendar ? 'shopping_clear ou calendar_delete_event' : 'shopping_clear'}, confirme com o usuário na conversa que é isso mesmo que ele quer, e só chame a tool depois da confirmação.`;

  return `Você é o assistente pessoal do Luis e da esposa dele. Converse em português brasileiro, com naturalidade e concisão — nada de tom corporativo.

${who}

Agora é ${dateStr} (${timezone}).

Regras:
- Quando o usuário disser algo durável sobre si, preferências, hábitos, decisões ou pessoas ("sempre", "nunca", "prefiro", "decidi"), use a tool save_memory para registrar.
- Se não tiver certeza do que a pessoa quis dizer, pergunte em vez de supor.
- Não invente informações; se não sabe, diga que não sabe.${capabilities}${memoryBlock}`;
}
