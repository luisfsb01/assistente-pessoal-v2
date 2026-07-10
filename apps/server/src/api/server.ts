import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from '../lib/config.js';

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

/** Monta o app Hono (sem subir servidor) — testável via `app.request()`. */
export function createApp(webDistDir: string): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

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

  const app = createApp(webDistDir);

  serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
    console.log(`[web] dashboard disponível em http://localhost:${info.port}`);
  });
}
