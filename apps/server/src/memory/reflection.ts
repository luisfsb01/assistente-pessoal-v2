import { z } from 'zod';
import { getMessagesSince } from '../db/messages.js';
import { getChatIdentity } from '../db/chats.js';
import {
  expireMemory,
  insertMemory,
  listActiveMemories,
  updateMemoryContent,
  type MemorySubject,
  type MemoryType,
} from '../db/memories.js';
import { getState, setState } from '../db/state.js';
import { generateAgentObject } from '../agent/models.js';
import { embedText } from './embeddings.js';

export const reflectionOutputSchema = z.object({
  ops: z.array(
    z.discriminatedUnion('action', [
      z.object({
        action: z.literal('add'),
        subject: z.enum(['luis', 'esposa', 'casal']),
        type: z.enum(['preference', 'habit', 'fact', 'decision', 'person']),
        content: z.string(),
      }),
      z.object({ action: z.literal('update'), id: z.string(), content: z.string() }),
      z.object({ action: z.literal('expire'), id: z.string() }),
    ]),
  ),
});

export type ReflectionOp = z.infer<typeof reflectionOutputSchema>['ops'][number];

export type ReflectionRepo = {
  insert: (op: Extract<ReflectionOp, { action: 'add' }>) => Promise<void>;
  update: (id: string, content: string) => Promise<void>;
  expire: (id: string) => Promise<void>;
};

export async function applyOps(
  ops: ReflectionOp[],
  repo: ReflectionRepo,
): Promise<{ added: number; updated: number; expired: number }> {
  const result = { added: 0, updated: 0, expired: 0 };
  for (const op of ops) {
    try {
      if (op.action === 'add') {
        await repo.insert(op);
        result.added++;
      } else if (op.action === 'update') {
        await repo.update(op.id, op.content);
        result.updated++;
      } else {
        await repo.expire(op.id);
        result.expired++;
      }
    } catch (err) {
      console.error('[reflection] op falhou', op, err);
    }
  }
  return result;
}

const STATE_KEY = 'last_reflection_at';
const SYSTEM = `Você mantém a memória de longo prazo de um assistente pessoal de um casal (Luis e esposa).
Analise as conversas do dia e as memórias existentes e produza operações:
- add: fato durável NOVO (preferência, hábito, fato, decisão, pessoa). Frases autossuficientes em PT-BR. Nada efêmero (compromissos pontuais, small talk).
- update: memória existente cujo conteúdo mudou (use o id dela).
- expire: memória existente que ficou obsoleta ou foi contradita.
Inclua também preferências sobre a conduta do assistente (ex.: "não avisar sobre X").
Se nada durável aconteceu, retorne ops vazio.`;

function chatLabel(
  identity: { kind: 'private' | 'group'; subject: 'luis' | 'esposa' | null } | null,
  chatId: number,
): string {
  if (!identity) return `[chat ${chatId}]`;
  if (identity.kind === 'group') return '[grupo]';
  if (identity.subject === 'luis') return '[privado do Luis]';
  if (identity.subject === 'esposa') return '[privado da Esposa]';
  return `[chat ${chatId}]`;
}

export async function runReflection(deps = {
  getMessagesSince,
  listActiveMemories,
  getState,
  setState,
  getChatIdentity,
  generate: generateAgentObject,
  repo: {
    insert: async (op: Extract<ReflectionOp, { action: 'add' }>) =>
      insertMemory({
        subject: op.subject as MemorySubject,
        type: op.type as MemoryType,
        content: op.content,
        embedding: await embedText(op.content),
        source: 'reflection',
      }),
    update: async (id: string, content: string) =>
      updateMemoryContent(id, content, await embedText(content)),
    expire: expireMemory,
  } satisfies ReflectionRepo,
}): Promise<{ added: number; updated: number; expired: number }> {
  const since =
    (await deps.getState<string>(STATE_KEY)) ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const startedAt = new Date().toISOString();
  const messages = await deps.getMessagesSince(since);

  if (messages.length === 0) {
    await deps.setState(STATE_KEY, startedAt);
    return { added: 0, updated: 0, expired: 0 };
  }

  const existing = await deps.listActiveMemories(200);

  const distinctChatIds = [...new Set(messages.map((m) => m.chatId))];
  const identities = await Promise.all(distinctChatIds.map((id) => deps.getChatIdentity(id)));
  const labelByChatId = new Map<number, string>(
    distinctChatIds.map((id, i) => [id, chatLabel(identities[i], id)]),
  );

  const prompt = `MEMÓRIAS EXISTENTES:\n${existing
    .map((m) => `${m.id} [${m.subject}/${m.type}] ${m.content}`)
    .join('\n') || '(nenhuma)'}\n\nCONVERSAS DESDE ${since}:\n${messages
    .map((m) => `${labelByChatId.get(m.chatId) ?? `[chat ${m.chatId}]`} ${m.role}: ${m.content}`)
    .join('\n')}`;

  const output = await deps.generate({
    purpose: 'reflection',
    system: SYSTEM,
    prompt,
    schema: reflectionOutputSchema,
  });

  const result = await applyOps(output.ops, deps.repo);
  await deps.setState(STATE_KEY, startedAt);
  console.log('[reflection]', result);
  return result;
}
