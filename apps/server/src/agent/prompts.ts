import type { ChatIdentity } from '../db/chats.js';
import type { Memory, MemorySubject } from '../db/memories.js';
import { capabilitiesForChat } from './capabilities.js';

export function subjectsForChat(identity: ChatIdentity): MemorySubject[] {
  if (identity.kind === 'group') return ['casal'];
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
  const capabilities = capabilitiesForChat(identity);
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

  const capabilityLines = [
    capabilities.has('tasks')
      ? `- Tarefas: cada pessoa tem sua própria lista de tarefas (tools tasks_list, tasks_add, tasks_complete, tasks_update). ${ownerNote}`
      : '',
    capabilities.has('calendar') && hasCalendar
      ? `- Agenda: cada pessoa tem sua própria agenda do Google Calendar (tools calendar_list_events, calendar_create_event, calendar_update_event, calendar_delete_event). Resolva datas relativas usando a data atual acima.`
      : '',
    capabilities.has('shopping')
      ? '- Lista de compras: uma lista única do casal (tools shopping_list, shopping_add, shopping_remove, shopping_clear).'
      : '',
    capabilities.has('finance')
      ? '- Finanças: tools finance_add_transaction, finance_list_transactions, finance_month_summary, finance_list_categories, finance_create_category, finance_classify_transaction, finance_confirm_transaction, finance_add_commitment, finance_list_commitments, finance_remove_commitment.'
      : '',
    capabilities.has('knowledge')
      ? '- Segundo cérebro: use knowledge_save para links pedidos e knowledge_search para conteúdo salvo; cite notas como [[nome]].'
      : '',
    capabilities.has('habits')
      ? '- Hábitos: tools habit_define, habit_list, habit_checkin e habit_archive.'
      : '',
    capabilities.has('projects')
      ? '- Projetos: tools project_create, project_note, project_set_status, project_overview, project_task_add, project_task_move, project_task_list e project_archive.'
      : '',
  ].filter(Boolean);

  const toolRules = [
    capabilities.has('tasks')
      ? `- Para concluir uma tarefa, liste primeiro com tasks_list para obter o id correto.
- Nunca pergunte se uma tarefa é recorrente quando a pessoa não mencionar recorrência.
- Se a pessoa disser explicitamente que a tarefa é recorrente, colete apenas o que faltar, uma pergunta por vez: primeiro a frequência e depois a data até quando deve repetir. Não repita dados já informados.
- Só use tasks_add para uma tarefa recorrente quando frequência e data final estiverem definidas; envie esses dados em recurrence.
- Rotinas recorrentes e afazeres domésticos são tarefas, mesmo quando a pessoa informa um horário. Tarefas nunca vão para o calendário só por terem data, horário ou recorrência.
- Só trate como agenda se a pessoa disser explicitamente evento, agenda, calendário ou compromisso. Nunca ofereça hábito ou calendário como alternativa para uma tarefa recorrente.`
      : '',
    capabilities.has('calendar') && hasCalendar
      ? '- Para alterar ou excluir evento, liste primeiro com calendar_list_events; confirme antes de excluir. calendar_create_event não suporta recorrência: nunca crie um evento único e o descreva como recorrente.'
      : '',
    capabilities.has('shopping')
      ? '- Para remover item, liste primeiro com shopping_list; confirme antes de shopping_clear.'
      : '',
    capabilities.has('finance')
      ? '- Finanças: códigos curtos como A001 usam finance_classify_transaction; consulte finance_list_categories se necessário.'
      : '',
  ].filter(Boolean);

  const capabilitiesBlock = `

Capacidades:
${capabilityLines.join('\n')}

Instruções para usar as tools:
${toolRules.join('\n')}

Estilo das respostas (siga à risca):
- NUNCA mostre ids/UUIDs ao usuário — eles são uso interno seu. Liste itens como lista numerada simples.
- Datas no formato brasileiro curto (ex.: "sex 14/07", "14/07 às 15h"), nunca "2026-07-14".
- Depois de executar algo, confirme em UMA frase curta e pare. NÃO termine oferecendo ações extras ("Quer que eu...?", "Deseja adicionar...?") — o usuário pede se quiser.
- Só pergunte o que for estritamente necessário para executar o pedido, UMA pergunta por vez, e nunca repita uma pergunta que o usuário já respondeu. Detalhes opcionais (local, observação, quantidade, marca, recorrência) não se perguntam: só inclua se o usuário mencionar.`;

  return `Você é o assistente pessoal do Luis e da esposa dele. Converse em português brasileiro, com naturalidade e concisão — nada de tom corporativo.

${who}

Agora é ${dateStr} (${timezone}).

Regras:
- Quando o usuário disser algo durável sobre si, preferências, hábitos, decisões ou pessoas ("sempre", "nunca", "prefiro", "decidi"), use save_memory apenas para o sujeito permitido neste chat.
- Se não tiver certeza do que a pessoa quis dizer, pergunte em vez de supor.
- Não invente informações; se não sabe, diga que não sabe.${capabilitiesBlock}${memoryBlock}`;
}
