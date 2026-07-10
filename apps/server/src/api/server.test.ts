import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, resolveWebDist } from './server.js';

describe('resolveWebDist', () => {
  it('resolve para apps/web/dist relativo ao cwd informado', () => {
    const cwd = join('algum', 'repo');
    const result = resolveWebDist(cwd).replace(/\\/g, '/');
    expect(result.endsWith('algum/repo/apps/web/dist')).toBe(true);
  });
});

describe('createApp', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>spa-fallback</body></html>');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /health retorna { ok: true }', async () => {
    const app = createApp(dir);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('faz fallback para index.html em rotas desconhecidas (SPA)', async () => {
    const app = createApp(dir);
    const res = await app.request('/rota-qualquer-do-spa');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('spa-fallback');
  });
});
