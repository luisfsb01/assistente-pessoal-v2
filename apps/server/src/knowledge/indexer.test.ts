import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown, hashText, indexFile, reindexVault, type IndexerDeps } from './indexer.js';

describe('chunkMarkdown', () => {
  it('junta parágrafos até o limite e nunca devolve vazio', () => {
    const text = ['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(500)].join('\n\n');
    const chunks = chunkMarkdown(text, 1200);
    expect(chunks.length).toBe(2); // 500+500 cabem juntos; o terceiro vai sozinho
    expect(chunks.every((c) => c.length <= 1200)).toBe(true);
  });
  it('parágrafo gigante é cortado no limite', () => {
    const chunks = chunkMarkdown('x'.repeat(3000), 1200);
    expect(chunks.length).toBe(3);
  });
  it('texto vazio → sem chunks', () => {
    expect(chunkMarkdown('  \n\n ')).toEqual([]);
  });
});

describe('hashText', () => {
  it('é determinístico e sensível ao conteúdo', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

function deps(over: Partial<IndexerDeps> = {}) {
  const replaced: Array<{ path: string; hash: string; n: number }> = [];
  const d: IndexerDeps = {
    readNoteRaw: async () => 'conteúdo da nota',
    getIndexedFileHash: async () => null,
    replaceFileChunks: async (path, hash, chunks) => void replaced.push({ path, hash, n: chunks.length }),
    embed: async () => [0.1, 0.2],
    ...over,
  };
  return { d, replaced };
}

describe('indexFile', () => {
  it('indexa arquivo novo (chunks com embedding e hash do arquivo)', async () => {
    const { d, replaced } = deps();
    expect(await indexFile('Sources/a.md', d)).toBe('indexed');
    expect(replaced).toHaveLength(1);
    expect(replaced[0].path).toBe('Sources/a.md');
    expect(replaced[0].hash).toBe(hashText('conteúdo da nota'));
    expect(replaced[0].n).toBeGreaterThan(0);
  });
  it('arquivo inalterado não re-embeda', async () => {
    let embedded = 0;
    const { d } = deps({
      getIndexedFileHash: async () => hashText('conteúdo da nota'),
      embed: async () => {
        embedded++;
        return [0];
      },
    });
    expect(await indexFile('Sources/a.md', d)).toBe('unchanged');
    expect(embedded).toBe(0);
  });
  it('arquivo sem chunks (vazio) não mexe no banco', async () => {
    const { d, replaced } = deps({ readNoteRaw: async () => '  \n\n ' });
    expect(await indexFile('Sources/vazio.md', d)).toBe('unchanged');
    expect(replaced).toHaveLength(0);
  });
});

describe('reindexVault', () => {
  it('varre Sources+Wiki; falha em um arquivo não derruba os outros', async () => {
    const { d } = deps({
      readNoteRaw: async (p) => {
        if (p === 'Sources/ruim.md') throw new Error('io');
        return 'ok';
      },
    });
    const out = await reindexVault({
      ...d,
      listSourcePaths: async () => ['Sources/ruim.md', 'Sources/bom.md'],
      listWikiPaths: async () => ['Wiki/Index.md'],
    });
    expect(out).toEqual({ indexed: 2, unchanged: 0, failed: 1 });
  });
});
