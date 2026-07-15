import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { buildKnowledgeTools, noteNameFromPath, type KnowledgeToolDeps } from './knowledge.js';

function deps(over: Partial<KnowledgeToolDeps> = {}) {
  const saved: string[] = [];
  const indexed: string[] = [];
  const d: KnowledgeToolDeps = {
    extract: async (url) => ({ kind: 'article', title: 'Título X', markdown: 'corpo do artigo '.repeat(100) }),
    writeSourceNote: async (n) => {
      saved.push(n.title);
      return 'Sources/2026-07-15-titulo-x.md';
    },
    indexFile: async (p) => {
      indexed.push(p);
      return 'indexed';
    },
    embed: async () => [0.1],
    search: async () => [],
    nowIso: () => '2026-07-15T18:00:00.000Z',
    ...over,
  };
  return { d, saved, indexed };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  const t = toolset[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('noteNameFromPath', () => {
  it('nome da nota sem pasta e sem .md', () => {
    expect(noteNameFromPath('Sources/2026-07-15-titulo-x.md')).toBe('2026-07-15-titulo-x');
    expect(noteNameFromPath('Wiki/Prompt Engineering.md')).toBe('Prompt Engineering');
  });
});

describe('knowledge_save', () => {
  it('extrai, salva, indexa e devolve título+trecho', async () => {
    const { d, saved, indexed } = deps();
    const out = JSON.parse(await run(buildKnowledgeTools(d) as never, 'knowledge_save', { url: 'https://x.com/a' }));
    expect(saved).toEqual(['Título X']);
    expect(indexed).toEqual(['Sources/2026-07-15-titulo-x.md']);
    expect(out.titulo).toBe('Título X');
    expect(out.tipo).toBe('article');
    expect(out.trecho.length).toBeLessThanOrEqual(600);
  });

  it('falha do índice não perde a nota (ainda retorna salvo)', async () => {
    const { d } = deps({
      indexFile: async () => {
        throw new Error('supabase fora');
      },
    });
    const out = JSON.parse(await run(buildKnowledgeTools(d) as never, 'knowledge_save', { url: 'https://x.com/a' }));
    expect(out.salvo).toBe('Sources/2026-07-15-titulo-x.md');
  });

  it('falha total responde mensagem de erro amigável', async () => {
    const { d } = deps({
      writeSourceNote: async () => {
        throw new Error('disco cheio');
      },
    });
    const out = await run(buildKnowledgeTools(d) as never, 'knowledge_save', { url: 'https://x.com/a' });
    expect(out).toContain('Não consegui');
  });
});

describe('knowledge_search', () => {
  it('devolve notas citáveis com trecho', async () => {
    const { d } = deps({
      search: async () => [
        { path: 'Wiki/Prompt Engineering.md', content: 'few-shot é...', similarity: 0.9 },
      ],
    });
    const out = JSON.parse(await run(buildKnowledgeTools(d) as never, 'knowledge_search', { query: 'few shot' }));
    expect(out[0].nota).toBe('Prompt Engineering');
    expect(out[0].trecho).toContain('few-shot');
  });

  it('sem resultados, avisa em PT-BR', async () => {
    const { d } = deps();
    const out = await run(buildKnowledgeTools(d) as never, 'knowledge_search', { query: 'x' });
    expect(out).toContain('Nada salvo');
  });
});
