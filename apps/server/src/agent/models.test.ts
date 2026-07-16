// Deve ser o PRIMEIRO import: semeia env vars fake antes que a cadeia de imports
// de './models.js' avalie db/client.ts (que chama getConfig() no top-level).
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV2 } from 'ai/test';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
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
  it('categorize usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('categorize', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
  it('judgment usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('judgment', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
  it('librarian usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('librarian', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
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

  it('registra a soma do uso de TODOS os passos (totalUsage), não só do último', async () => {
    const recorded: UsageRow[] = [];
    let call = 0;
    const twoStepModel = new MockLanguageModelV2({
      doGenerate: async () => {
        call++;
        if (call === 1) {
          return {
            finishReason: 'tool-calls',
            usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
            content: [{ type: 'tool-call', toolCallId: 'call1', toolName: 'ping', input: '{}' }],
            warnings: [],
          };
        }
        return {
          finishReason: 'stop',
          usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 },
          content: [{ type: 'text', text: 'pronto' }],
          warnings: [],
        };
      },
    });
    const tools: ToolSet = {
      ping: tool({
        description: 'ping de teste',
        inputSchema: z.object({}),
        execute: async () => 'pong',
      }),
    };
    const deps: LlmDeps = {
      createModel: () => twoStepModel,
      record: async (u) => {
        recorded.push(u);
      },
      monthCost: async () => 0,
    };

    const text = await generateAgentText(
      { purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'olá' }], tools },
      deps,
    );

    expect(text).toBe('pronto');
    expect(recorded).toHaveLength(1);
    // soma dos dois passos: input 50+80=130, output 10+15=25 (não apenas o último passo: 80/15)
    expect(recorded[0].inputTokens).toBe(130);
    expect(recorded[0].outputTokens).toBe(25);
  });
});
