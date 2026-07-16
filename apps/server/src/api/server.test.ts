import '../test-setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, resolveWebDist, type ApiDeps } from './server.js';

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

  function fakeDeps(over: Partial<ApiDeps> = {}): ApiDeps {
    return {
      isValidToken: async (t) => t === 'token-bom',
      embedText: async () => [0.1, 0.2],
      updateMemoryContent: async () => true,
      getMonthCostBrl: async () => 12.34,
      getMonthCostByPurpose: async () => [{ purpose: 'chat', costBrl: 10 }],
      budgetBrl: () => 50,
      ...over,
    };
  }

  describe('API /api (Fase 8)', () => {
    const auth = { Authorization: 'Bearer token-bom' };

    it('401 sem token e com token inválido', async () => {
      const app = createApp(dir, fakeDeps());
      expect((await app.request('/api/llm-cost')).status).toBe(401);
      expect(
        (await app.request('/api/llm-cost', { headers: { Authorization: 'Bearer ruim' } })).status,
      ).toBe(401);
    });

    it('GET /api/llm-cost retorna gasto, teto e quebra por finalidade', async () => {
      const app = createApp(dir, fakeDeps());
      const res = await app.request('/api/llm-cost', { headers: auth });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        spentBrl: 12.34,
        budgetBrl: 50,
        byPurpose: [{ purpose: 'chat', costBrl: 10 }],
      });
    });

    it('PUT /api/memories/:id regera o embedding e atualiza', async () => {
      const calls: unknown[] = [];
      const app = createApp(
        dir,
        fakeDeps({
          updateMemoryContent: async (id, content, embedding) => {
            calls.push([id, content, embedding]);
            return true;
          },
        }),
      );
      const res = await app.request('/api/memories/abc-123', {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'novo texto' }),
      });
      expect(res.status).toBe(200);
      expect(calls).toEqual([['abc-123', 'novo texto', [0.1, 0.2]]]);
    });

    it('PUT /api/memories/:id: 400 sem content, 404 id inexistente', async () => {
      const app = createApp(dir, fakeDeps({ updateMemoryContent: async () => false }));
      const sem = await app.request('/api/memories/x', {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '  ' }),
      });
      expect(sem.status).toBe(400);
      const inexistente = await app.request('/api/memories/x', {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'ok' }),
      });
      expect(inexistente.status).toBe(404);
    });

    it('rota /api desconhecida responde 404 (não cai no fallback da SPA)', async () => {
      const app = createApp(dir, fakeDeps());
      const res = await app.request('/api/nada', { headers: auth });
      expect(res.status).toBe(404);
    });
  });
});
