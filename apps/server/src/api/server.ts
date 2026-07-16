import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from '../lib/config.js';
import { getConfig } from '../lib/config.js';
import { embedText } from '../memory/embeddings.js';
import { updateMemoryContent } from '../db/memories.js';
import { getMonthCostBrl, getMonthCostByPurpose } from '../db/usage.js';
import { bearerToken, isValidAccessToken } from './auth.js';

/**
 * Resolve o caminho do build da SPA (`apps/web/dist`).
 *
 * Tanto em dev (tsx a partir da raiz do repo) quanto no Docker (node
 * apps/server/dist/index.js rodando com WORKDIR /app), o processo é
 * iniciado com a raiz do repositório como `process.cwd()`. Por isso
 * resolver relativo ao cwd funciona nos dois contextos.
 */
export function resolveWebDist(cwd: string = process.cwd()): string {
  return resolve(cwd, 'apps/web/dist');
}

export type ApiDeps = {
  isValidToken(token: string): Promise<boolean>;
  embedText(text: string): Promise<number[]>;
  updateMemoryContent(id: string, content: string, embedding: number[]): Promise<boolean>;
  getMonthCostBrl(): Promise<number>;
  getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>>;
  budgetBrl(): number;
};

export function defaultApiDeps(): ApiDeps {
  return {
    isValidToken: isValidAccessToken,
    embedText,
    updateMemoryContent,
    getMonthCostBrl,
    getMonthCostByPurpose,
    budgetBrl: () => getConfig().LLM_BUDGET_BRL,
  };
}

/** Monta o app Hono (sem subir servidor) — testável via `app.request()`. */
export function createApp(webDistDir: string, deps: ApiDeps = defaultApiDeps()): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // API do web (Fase 8): autenticada pelo access token do Supabase Auth
  app.use('/api/*', async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token || !(await deps.isValidToken(token))) {
      return c.json({ error: 'não autorizado' }, 401);
    }
    await next();
  });

  app.get('/api/llm-cost', async (c) => {
    const [spentBrl, byPurpose] = await Promise.all([
      deps.getMonthCostBrl(),
      deps.getMonthCostByPurpose(),
    ]);
    return c.json({ spentBrl, budgetBrl: deps.budgetBrl(), byPurpose });
  });

  app.put('/api/memories/:id', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ error: 'content obrigatório' }, 400);
    const embedding = await deps.embedText(content);
    const found = await deps.updateMemoryContent(c.req.param('id'), content, embedding);
    if (!found) return c.json({ error: 'memória não encontrada' }, 404);
    return c.json({ ok: true });
  });

  // /api desconhecida: 404 explícito (não cai no fallback da SPA)
  app.all('/api/*', (c) => c.json({ error: 'rota desconhecida' }, 404));

  app.use('*', serveStatic({ root: webDistDir }));
  app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));

  return app;
}

export function startWebServer(cfg: Config): void {
  const webDistDir = resolveWebDist();

  if (!existsSync(webDistDir)) {
    console.warn(`[web] diretório ${webDistDir} não encontrado; servidor http não será iniciado.`);
    return;
  }

  const app = createApp(webDistDir, defaultApiDeps());

  serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
    console.log(`[web] dashboard disponível em http://localhost:${info.port}`);
  });
}
