import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const minimal = {
  TELEGRAM_TOKEN: 't',
  OPENAI_API_KEY: 'k',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
};

describe('loadConfig', () => {
  it('aplica defaults quando opcionais faltam', () => {
    const cfg = loadConfig(minimal as NodeJS.ProcessEnv);
    expect(cfg.MODEL_DEFAULT_ID).toBe('gpt-5-mini');
    expect(cfg.MODEL_STRONG_ID).toBe('gpt-5.5');
    expect(cfg.EMBEDDING_MODEL_ID).toBe('text-embedding-3-small');
    expect(cfg.LLM_BUDGET_BRL).toBe(50);
    expect(cfg.USD_BRL_RATE).toBe(5.5);
    expect(cfg.TIMEZONE).toBe('America/Sao_Paulo');
    expect(cfg.PORT).toBe(8080);
  });

  it('converte números vindos de string', () => {
    const cfg = loadConfig({ ...minimal, LLM_BUDGET_BRL: '80' } as NodeJS.ProcessEnv);
    expect(cfg.LLM_BUDGET_BRL).toBe(80);
  });

  it('falha sem TELEGRAM_TOKEN', () => {
    const { TELEGRAM_TOKEN: _omit, ...rest } = minimal;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow();
  });

  it('credenciais Google são opcionais', () => {
    const cfg = loadConfig(minimal as NodeJS.ProcessEnv);
    expect(cfg.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('aceita endpoint LLM compatível e trata string vazia como ausente', () => {
    const cfg = loadConfig({
      ...minimal,
      LLM_API_KEY: 'outra-chave',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    } as NodeJS.ProcessEnv);
    expect(cfg.LLM_API_KEY).toBe('outra-chave');
    expect(cfg.LLM_BASE_URL).toBe('https://openrouter.ai/api/v1');

    const empty = loadConfig({ ...minimal, LLM_API_KEY: '', LLM_BASE_URL: '' } as NodeJS.ProcessEnv);
    expect(empty.LLM_API_KEY).toBeUndefined();
    expect(empty.LLM_BASE_URL).toBeUndefined();
  });
});
