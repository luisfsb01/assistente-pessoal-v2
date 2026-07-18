import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from '../lib/config.js';
import { getConfig } from '../lib/config.js';
import { embedText } from '../memory/embeddings.js';
import { updateMemoryContent } from '../db/memories.js';
import { getMonthCostBrl, getMonthCostByPurpose, getMonthlyCostHistory } from '../db/usage.js';
import { bearerToken, isValidAccessToken } from './auth.js';
import { createHash } from 'node:crypto';
import { FixedWindowRateLimiter } from '../lib/rate-limit.js';
import { BankNotConfiguredError, syncBankTransactionsToToday } from '../services/bank-sync.js';

/**
 * Resolve o caminho do build da SPA (`apps/web/dist`).
 *
 * Tanto em dev (tsx a partir da raiz do repo) quanto no Docker (node
 * apps/server/dist/index.js rodando com WORKDIR /app), o processo é
 * iniciado com a raiz do repositório como `process.cwd()`. Por isso
 * resolver relativo ao cwd funciona nos dois contextos.
 */
export function resolveWebDist(repoRoot?: string): string {
  if (repoRoot) return resolve(repoRoot, 'apps/web/dist');

  // npm executa scripts de workspace com cwd=apps/server. Resolver a partir
  // deste módulo funciona tanto em src/api quanto no build em dist/api e não
  // depende do diretório em que o processo foi iniciado.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, '../../../web/dist');
}

export type ApiDeps = {
  isValidToken(token: string): Promise<boolean>;
  embedText(text: string): Promise<number[]>;
  updateMemoryContent(id: string, content: string, embedding: number[]): Promise<boolean>;
  getMonthCostBrl(): Promise<number>;
  getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>>;
  getMonthlyCostHistory(): Promise<Array<{ month: string; costBrl: number }>>;
  syncBankTransactions(): Promise<{ from: string; to: string; imported: number; autoClassified: number }>;
  budgetBrl(): number;
};

export function defaultApiDeps(): ApiDeps {
  return {
    isValidToken: isValidAccessToken,
    embedText,
    updateMemoryContent,
    getMonthCostBrl,
    getMonthCostByPurpose,
    getMonthlyCostHistory,
    syncBankTransactions: syncBankTransactionsToToday,
    budgetBrl: () => getConfig().LLM_BUDGET_BRL,
  };
}

/** Monta o app Hono (sem subir servidor) — testável via `app.request()`. */
export function createApp(
  webDistDir: string,
  deps: ApiDeps = defaultApiDeps(),
  security: { supabaseUrl?: string } = {},
): Hono {
  const app = new Hono();
  const preAuthLimiter = new FixedWindowRateLimiter(600, 60_000);
  const apiLimiter = new FixedWindowRateLimiter(120, 60_000);
  const connectSrc = ["'self'"];
  if (security.supabaseUrl) {
    const origin = new URL(security.supabaseUrl).origin;
    connectSrc.push(origin, origin.replace(/^http/, 'ws'));
  }

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc,
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera: ['none'],
      microphone: ['none'],
      geolocation: ['none'],
    },
  }));

  app.get('/health', (c) => c.json({ ok: true }));

  // API do web (Fase 8): autenticada pelo access token do Supabase Auth
  app.use('/api/*', async (c, next) => {
    // Evita que uma enxurrada de tokens inválidos gere chamadas ilimitadas ao Auth.
    if (!preAuthLimiter.allow('global')) return c.json({ error: 'muitas requisições' }, 429);
    const token = bearerToken(c.req.header('Authorization'));
    if (!token || !(await deps.isValidToken(token))) {
      return c.json({ error: 'não autorizado' }, 401);
    }
    const tokenKey = createHash('sha256').update(token).digest('hex');
    if (!apiLimiter.allow(tokenKey)) return c.json({ error: 'muitas requisições' }, 429);
    await next();
  });
  app.use('/api/*', bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ error: 'corpo da requisição muito grande' }, 413),
  }));
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/api/llm-cost', async (c) => {
    const [spentBrl, byPurpose, history] = await Promise.all([
      deps.getMonthCostBrl(),
      deps.getMonthCostByPurpose(),
      deps.getMonthlyCostHistory(),
    ]);
    return c.json({ spentBrl, budgetBrl: deps.budgetBrl(), byPurpose, history });
  });

  app.post('/api/finance/sync', async (c) => {
    try {
      return c.json(await deps.syncBankTransactions());
    } catch (err) {
      if (err instanceof BankNotConfiguredError) {
        return c.json({ error: err.message }, 503);
      }
      console.error('[api:finance-sync] sincronização falhou:', err);
      return c.json({ error: 'Não foi possível buscar novas transações agora.' }, 502);
    }
  });

  app.put('/api/memories/:id', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ error: 'content obrigatório' }, 400);
    if (content.length > 5_000) return c.json({ error: 'content excede 5000 caracteres' }, 400);
    const embedding = await deps.embedText(content);
    const found = await deps.updateMemoryContent(c.req.param('id'), content, embedding);
    if (!found) return c.json({ error: 'memória não encontrada' }, 404);
    return c.json({ ok: true });
  });

  // /api desconhecida: 404 explícito (não cai no fallback da SPA)
  app.all('/api/*', (c) => c.json({ error: 'rota desconhecida' }, 404));

  if (existsSync(webDistDir)) {
    app.use('*', serveStatic({ root: webDistDir }));
    app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));
  }

  return app;
}

export function startWebServer(cfg: Config): void {
  const webDistDir = resolveWebDist();
  const hasWebBuild = existsSync(webDistDir);

  if (!hasWebBuild) {
    console.warn(`[web] build em ${webDistDir} não encontrado; iniciando somente a API.`);
  }

  const app = createApp(webDistDir, defaultApiDeps(), { supabaseUrl: cfg.SUPABASE_URL });

  serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
    const service = hasWebBuild ? 'dashboard' : 'API';
    console.log(`[web] ${service} disponível em http://localhost:${info.port}`);
  });
}
