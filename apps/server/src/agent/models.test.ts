import { describe, expect, it } from 'vitest';
import { MockLanguageModelV2 } from 'ai/test';
import { loadConfig } from '../lib/config.js';
import type { UsageRow } from '../db/usage.js';
import { generateAgentText, pickModelId, type LlmDeps } from './models.js';

const cfg = loadConfig({
  TELEGRAM_TOKEN: 't',
  OPENAI_API_KEY: 'k',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
} as NodeJS.ProcessEnv);

function mockModel(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

function makeDeps(recorded: UsageRow[], monthCostBrl: number, replyText = 'oi!'): LlmDeps {
  return {
    createModel: () => mockModel(replyText),
    record: async (u) => {
      recorded.push(u);
    },
    monthCost: async () => monthCostBrl,
  };
}

describe('pickModelId', () => {
  it('chat usa o modelo default', () => {
    expect(pickModelId('chat', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
  it('briefing e analysis usam o modelo forte', () => {
    expect(pickModelId('briefing', 'ok', cfg)).toBe(cfg.MODEL_STRONG_ID);
    expect(pickModelId('analysis', 'warn', cfg)).toBe(cfg.MODEL_STRONG_ID);
  });
  it('orçamento estourado degrada tudo para o default', () => {
    expect(pickModelId('briefing', 'exceeded', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
});

describe('generateAgentText', () => {
  it('retorna o texto e registra o uso', async () => {
    const recorded: UsageRow[] = [];
    const text = await generateAgentText(
      { purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'olá' }] },
      makeDeps(recorded, 0),
    );
    expect(text).toBe('oi!');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].purpose).toBe('chat');
    expect(recorded[0].inputTokens).toBe(100);
    expect(recorded[0].costBrl).toBeGreaterThan(0);
  });

  it('dispara onBudgetAlert quando o status não é ok', async () => {
    const alerts: string[] = [];
    await generateAgentText(
      {
        purpose: 'chat',
        system: 'sys',
        messages: [{ role: 'user', content: 'olá' }],
        onBudgetAlert: async (status) => {
          alerts.push(status);
        },
      },
      makeDeps([], 45), // 45 >= 80% de 50
    );
    expect(alerts).toEqual(['warn']);
  });
});
