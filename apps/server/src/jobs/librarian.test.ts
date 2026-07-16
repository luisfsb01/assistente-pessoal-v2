import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { runLibrarian, type LibrarianDeps } from './librarian.js';

function deps(over: Partial<LibrarianDeps> = {}) {
  const state = new Map<string, unknown>();
  const wiki: Array<{ name: string; content: string }> = [];
  const indexed: string[] = [];
  const d: LibrarianDeps = {
    listSourcePaths: async () => ['Sources/a.md'],
    listWikiPaths: async () => [],
    readNoteRaw: async () => 'conteúdo da fonte',
    writeWikiPage: async (name, content) => {
      wiki.push({ name, content });
      return `Wiki/${name}.md`;
    },
    indexFile: async (p) => {
      indexed.push(p);
      return 'indexed';
    },
    getState: async (k) => (state.get(k) as never) ?? null,
    setState: async (k, v) => void state.set(k, v),
    generate: async () =>
      ({ pages: [{ name: 'Conceito', content: 'página com [[links]]' }], index: '# Índice' }) as never,
    ...over,
  };
  return { d, state, wiki, indexed };
}

describe('runLibrarian', () => {
  it('processa fonte nova: grava páginas + Index, indexa e marca processada', async () => {
    const { d, state, wiki, indexed } = deps();
    const out = await runLibrarian(d);
    expect(out).toEqual({ processed: 1, pages: 1 });
    expect(wiki.map((w) => w.name)).toEqual(['Conceito', 'Index']);
    expect(indexed).toEqual(['Wiki/Conceito.md', 'Wiki/Index.md']);
    expect(state.get('librarian_state')).toEqual({ processed: ['Sources/a.md'] });
  });

  it('fonte já processada não roda de novo (não chama a IA)', async () => {
    let called = 0;
    const { d, state } = deps({
      generate: async () => {
        called++;
        return { pages: [], index: '' } as never;
      },
    });
    state.set('librarian_state', { processed: ['Sources/a.md'] });
    const out = await runLibrarian(d);
    expect(out).toEqual({ processed: 0, pages: 0 });
    expect(called).toBe(0);
  });

  it('respeita o teto de 5 fontes por noite', async () => {
    let called = 0;
    const { d } = deps({
      listSourcePaths: async () => Array.from({ length: 8 }, (_, i) => `Sources/s${i}.md`),
      generate: async () => {
        called++;
        return { pages: [], index: '# I' } as never;
      },
    });
    const out = await runLibrarian(d);
    expect(out.processed).toBe(5);
    expect(called).toBe(5);
  });

  it('falha da IA numa fonte não derruba as outras nem a marca como processada', async () => {
    let call = 0;
    const { d, state } = deps({
      listSourcePaths: async () => ['Sources/a.md', 'Sources/b.md'],
      generate: async () => {
        call++;
        if (call === 1) throw new Error('boom');
        return { pages: [], index: '# I' } as never;
      },
    });
    const out = await runLibrarian(d);
    expect(out.processed).toBe(1);
    expect(state.get('librarian_state')).toEqual({ processed: ['Sources/b.md'] });
  });

  it('prompt inclui a fonte, as páginas existentes e o índice atual', async () => {
    let seen = '';
    const { d } = deps({
      listWikiPaths: async () => ['Wiki/Index.md', 'Wiki/Hábitos.md'],
      readNoteRaw: async (p) => {
        if (p === 'Wiki/Index.md') return '# Índice atual';
        if (p === 'Wiki/Hábitos.md') return 'corpo atual de hábitos';
        return 'texto da fonte X';
      },
      generate: async (opts: { prompt: string }) => {
        seen = opts.prompt;
        return { pages: [], index: '# I' } as never;
      },
    });
    await runLibrarian(d);
    expect(seen).toContain('texto da fonte X');
    expect(seen).toContain('Hábitos');
    expect(seen).toContain('corpo atual de hábitos');
    expect(seen).toContain('# Índice atual');
  });

  it('páginas além do teto entram só pelo nome', async () => {
    let seen = '';
    const extras = Array.from({ length: 22 }, (_, i) => `Wiki/P${String(i + 1).padStart(2, '0')}.md`);
    const { d } = deps({
      listWikiPaths: async () => ['Wiki/Index.md', ...extras],
      readNoteRaw: async (p) => (p === 'Wiki/Index.md' ? '# Índice atual' : p.startsWith('Wiki/') ? 'corpo' : 'texto da fonte X'),
      generate: async (opts: { prompt: string }) => {
        seen = opts.prompt;
        return { pages: [], index: '# I' } as never;
      },
    });
    await runLibrarian(d);
    expect(seen).toContain('corpo');
    expect(seen).toContain('P21');
    expect(seen).toContain('P22');
    expect(seen).toContain('Outras páginas, só pelo nome: P21, P22');
  });
});
