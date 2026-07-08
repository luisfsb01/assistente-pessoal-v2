import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import { getConfig } from '../lib/config.js';
import { estimateCostBrl } from '../lib/pricing.js';
import { recordUsage } from '../db/usage.js';

export async function embedText(text: string): Promise<number[]> {
  const cfg = getConfig();
  const openai = createOpenAI({ apiKey: cfg.OPENAI_API_KEY });
  const { embedding, usage } = await embed({
    model: openai.textEmbedding(cfg.EMBEDDING_MODEL_ID),
    value: text,
  });
  const tokens = usage?.tokens ?? 0;
  await recordUsage({
    model: cfg.EMBEDDING_MODEL_ID,
    purpose: 'embedding',
    inputTokens: tokens,
    outputTokens: 0,
    costBrl: estimateCostBrl(cfg.EMBEDDING_MODEL_ID, tokens, 0, cfg.USD_BRL_RATE),
  });
  return embedding;
}
