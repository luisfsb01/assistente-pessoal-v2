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
}): string {
  const { identity, memories, now, timezone } = args;
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

  return `Você é o assistente pessoal do Luis e da esposa dele. Converse em português brasileiro, com naturalidade e concisão — nada de tom corporativo.

${who}

Agora é ${dateStr} (${timezone}).

Regras:
- Quando o usuário disser algo durável sobre si, preferências, hábitos, decisões ou pessoas ("sempre", "nunca", "prefiro", "decidi"), use a tool save_memory para registrar.
- Se não tiver certeza do que a pessoa quis dizer, pergunte em vez de supor.
- Não invente informações; se não sabe, diga que não sabe.${memoryBlock}`;
}
