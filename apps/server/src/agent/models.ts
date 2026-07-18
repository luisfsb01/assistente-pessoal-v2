import { createOpenAI } from '@ai-sdk/openai';
import {
  generateObject,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';
import { budgetStatus, type BudgetStatus } from '../lib/budget.js';
import { getConfig, type Config } from '../lib/config.js';
import { estimateCostBrl } from '../lib/pricing.js';
import { getMonthCostBrl, recordUsage, type UsageRow } from '../db/usage.js';

export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize' | 'judgment' | 'librarian';

const STRONG_PURPOSES: ReadonlySet<Purpose> = new Set(['briefing', 'analysis']);

export function pickModelId(
  purpose: Purpose,
  status: BudgetStatus,
  cfg: Config,
  preferStrong = false,
): string {
  if (status !== 'exceeded' && (preferStrong || STRONG_PURPOSES.has(purpose))) return cfg.MODEL_STRONG_ID;
  return cfg.MODEL_DEFAULT_ID;
}

const CHAT_DOMAINS = [
  /\b(tarefa|prazo|pend[eê]ncia)\w*/i,
  /\b(agenda|calend[aá]rio|compromisso|reuni[aã]o)\w*/i,
  /\b(gasto|receita|or[cç]amento|finan[cç]|banco|fatura)\w*/i,
  /\b(h[aá]bito|academia|treino|leitura)\w*/i,
  /\b(projeto|kanban|status)\w*/i,
  /\b(e-?mail|gmail|mensagem)\w*/i,
  /\b(compra|mercado|lista)\w*/i,
];

/** Escala conversas que cruzam dois ou mais domínios pessoais. */
export function shouldUseStrongChatModel(text: string): boolean {
  return CHAT_DOMAINS.filter((pattern) => pattern.test(text)).length >= 2;
}

export type LlmDeps = {
  createModel: (modelId: string) => LanguageModel;
  record: (u: UsageRow) => Promise<void>;
  monthCost: () => Promise<number>;
};

export function defaultLlmDeps(): LlmDeps {
  const cfg = getConfig();
  const openai = createOpenAI({
    apiKey: cfg.LLM_API_KEY ?? cfg.OPENAI_API_KEY,
    ...(cfg.LLM_BASE_URL ? { baseURL: cfg.LLM_BASE_URL } : {}),
  });
  return { createModel: (id) => openai(id), record: recordUsage, monthCost: getMonthCostBrl };
}

type CommonOpts = {
  purpose: Purpose;
  preferStrong?: boolean;
  onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void>;
};

async function prepare(opts: CommonOpts, deps: LlmDeps) {
  const cfg = getConfig();
  const monthCost = await deps.monthCost();
  const status = budgetStatus(monthCost, cfg.LLM_BUDGET_BRL);
  if (status !== 'ok' && opts.onBudgetAlert) {
    try {
      await opts.onBudgetAlert(status, monthCost);
    } catch (err) {
      console.error('[models] onBudgetAlert falhou', err);
    }
  }
  return { cfg, modelId: pickModelId(opts.purpose, status, cfg, opts.preferStrong) };
}

async function record(
  deps: LlmDeps,
  cfg: Config,
  modelId: string,
  purpose: Purpose,
  usage: { inputTokens?: number; outputTokens?: number },
) {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  await deps.record({
    model: modelId,
    purpose,
    inputTokens,
    outputTokens,
    costBrl: estimateCostBrl(modelId, inputTokens, outputTokens, cfg.USD_BRL_RATE),
  });
}

export async function generateAgentText(
  opts: CommonOpts & { system: string; messages: ModelMessage[]; tools?: ToolSet },
  deps: LlmDeps = defaultLlmDeps(),
): Promise<string> {
  const { cfg, modelId } = await prepare(opts, deps);
  const result = await generateText({
    model: deps.createModel(modelId),
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: stepCountIs(8),
  });
  await record(deps, cfg, modelId, opts.purpose, result.totalUsage);
  return result.text;
}

export async function generateAgentObject<T>(
  opts: CommonOpts & { system: string; prompt: string; schema: z.Schema<T> },
  deps: LlmDeps = defaultLlmDeps(),
): Promise<T> {
  const { cfg, modelId } = await prepare(opts, deps);
  const result = await generateObject({
    model: deps.createModel(modelId),
    system: opts.system,
    prompt: opts.prompt,
    schema: opts.schema,
  });
  await record(deps, cfg, modelId, opts.purpose, result.usage);
  return result.object;
}
