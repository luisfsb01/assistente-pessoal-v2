import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { BudgetStatus } from '../lib/budget.js';
import { getConfig } from '../lib/config.js';
import { hasGoogleCreds, getCalendarClient } from '../lib/google.js';
import { getChatIdentity, getUserBySubject, type ChatIdentity } from '../db/chats.js';
import { getRecentMessages, saveMessage, type ChatRole } from '../db/messages.js';
import { insertMemory, type Memory, type MemorySubject } from '../db/memories.js';
import { embedText } from '../memory/embeddings.js';
import { recallMemories } from '../memory/recall.js';
import { buildTaskTools } from '../tools/tasks.js';
import { buildShoppingTools } from '../tools/shopping.js';
import { buildFinanceTools } from '../tools/finance.js';
import { buildKnowledgeTools } from '../tools/knowledge.js';
import { buildCalendarTools, calendarApiFromGoogle } from '../tools/calendar.js';
import { generateAgentText } from './models.js';
import { buildSystemPrompt, subjectsForChat } from './prompts.js';

export type AgentDeps = {
  getChatIdentity: (chatId: number) => Promise<ChatIdentity | null>;
  saveMessage: (m: { chatId: number; role: ChatRole; content: string }) => Promise<void>;
  getRecentMessages: (chatId: number, limit?: number) => Promise<{ role: ChatRole; content: string }[]>;
  recall: (text: string, subjects: MemorySubject[]) => Promise<Memory[]>;
  generate: typeof generateAgentText;
  buildTools: (identity: ChatIdentity) => ToolSet;
  onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void>;
};

function saveMemoryTool(): ToolSet {
  return {
    save_memory: tool({
      description:
        'Salva um fato durável sobre o usuário, o casal ou pessoas próximas (preferência, hábito, fato, decisão, pessoa). Use quando o usuário declarar algo que vale lembrar para sempre.',
      inputSchema: z.object({
        subject: z.enum(['luis', 'esposa', 'casal']),
        type: z.enum(['preference', 'habit', 'fact', 'decision', 'person']),
        content: z.string().describe('O fato, em uma frase autossuficiente em PT-BR'),
      }),
      execute: async ({ subject, type, content }) => {
        await insertMemory({ subject, type, content, embedding: await embedText(content), source: 'tool' });
        return 'Memória salva.';
      },
    }),
  };
}

export function buildTools(identity: ChatIdentity): ToolSet {
  const cfg = getConfig();
  return {
    ...saveMemoryTool(),
    ...buildTaskTools(identity),
    ...buildShoppingTools(identity),
    ...buildFinanceTools(),
    ...buildKnowledgeTools(),
    ...(hasGoogleCreds(cfg)
      ? buildCalendarTools(identity, {
          getUserBySubject,
          calendar: calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE),
          timezone: cfg.TIMEZONE,
        })
      : {}),
  };
}

export function defaultAgentDeps(
  onBudgetAlert?: AgentDeps['onBudgetAlert'],
): AgentDeps {
  return {
    getChatIdentity,
    saveMessage,
    getRecentMessages,
    recall: recallMemories,
    generate: generateAgentText,
    buildTools,
    onBudgetAlert,
  };
}

export async function handleMessage(
  msg: { chatId: number; text: string },
  deps: AgentDeps = defaultAgentDeps(),
): Promise<string | null> {
  const identity = await deps.getChatIdentity(msg.chatId);
  if (!identity) return null;

  await deps.saveMessage({ chatId: msg.chatId, role: 'user', content: msg.text });

  const [history, memories] = await Promise.all([
    deps.getRecentMessages(msg.chatId, 20),
    deps.recall(msg.text, subjectsForChat(identity)),
  ]);

  const cfg = getConfig();
  const system = buildSystemPrompt({
    identity,
    memories,
    now: new Date(),
    timezone: cfg.TIMEZONE,
    hasCalendar: hasGoogleCreds(cfg),
  });

  // histórico já inclui a mensagem recém-salva em produção; em fakes pode não incluir —
  // garante que a última mensagem é a atual sem duplicar
  const past = history.filter((_, i) => i < history.length - 1 || history.at(-1)?.content !== msg.text);
  const reply = await deps.generate({
    purpose: 'chat',
    system,
    messages: [...past, { role: 'user', content: msg.text }],
    tools: deps.buildTools(identity),
    onBudgetAlert: deps.onBudgetAlert,
  });

  await deps.saveMessage({ chatId: msg.chatId, role: 'assistant', content: reply });
  return reply;
}
