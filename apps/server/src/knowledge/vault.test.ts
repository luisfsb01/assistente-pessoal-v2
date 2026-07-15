import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSourceMarkdown,
  isSyncConflict,
  listSourcePaths,
  listWikiPaths,
  readNoteRaw,
  sanitizePageName,
  slugify,
  writeSourceNote,
  writeWikiPage,
  type SourceNote,
} from './vault.js';

let base = '';
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'vault-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const nota = (over: Partial<SourceNote> = {}): SourceNote => ({
  title: 'Atenção é tudo que você precisa!',
  url: 'https://example.com/artigo',
  origem: 'article',
  capturedAt: '2026-07-15T18:00:00.000Z',
  markdown: 'Corpo do artigo.',
  ...over,
});

describe('slugify', () => {
  it('remove acentos, pontuação e limita o tamanho', () => {
    expect(slugify('Atenção é tudo que você precisa!')).toBe('atencao-e-tudo-que-voce-precisa');
    expect(slugify('   ')).toBe('sem-titulo');
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('isSyncConflict', () => {
  it('detecta arquivos de conflito do Syncthing', () => {
    expect(isSyncConflict('nota.sync-conflict-20260715-abc.md')).toBe(true);
    expect(isSyncConflict('nota.md')).toBe(false);
  });
});

describe('buildSourceMarkdown', () => {
  it('frontmatter com título/url/origem/data e nota opcional', () => {
    const md = buildSourceMarkdown(nota({ note: 'ver seção 3' }));
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Atenção é tudo que você precisa!"');
    expect(md).toContain('url: "https://example.com/artigo"');
    expect(md).toContain('origem: article');
    expect(md).toContain('note: "ver seção 3"');
    expect(md).toContain('Corpo do artigo.');
  });
  it('sem nota, sem linha note', () => {
    expect(buildSourceMarkdown(nota())).not.toContain('note:');
  });
});

describe('writeSourceNote', () => {
  it('cria Sources/YYYY-MM-DD-slug.md e resolve colisão com sufixo', async () => {
    const p1 = await writeSourceNote(nota(), base);
    const p2 = await writeSourceNote(nota(), base);
    expect(p1).toBe('Sources/2026-07-15-atencao-e-tudo-que-voce-precisa.md');
    expect(p2).toBe('Sources/2026-07-15-atencao-e-tudo-que-voce-precisa-2.md');
    expect(await readFile(join(base, p1), 'utf8')).toContain('Corpo do artigo.');
  });
});

describe('writeWikiPage + sanitizePageName', () => {
  it('grava Wiki/<nome>.md e sanitiza caracteres perigosos', async () => {
    const rel = await writeWikiPage('Prompt Engineering', 'conteúdo', base);
    expect(rel).toBe('Wiki/Prompt Engineering.md');
    expect(sanitizePageName('a/b\\c:d?e')).toBe('a-b-c-d-e');
    expect(await readNoteRaw(rel, base)).toBe('conteúdo');
  });
});

describe('listSourcePaths / listWikiPaths', () => {
  it('lista .md ordenado, ignora sync-conflict; pasta ausente = []', async () => {
    expect(await listSourcePaths(base)).toEqual([]);
    await mkdir(join(base, 'Sources'), { recursive: true });
    await writeFile(join(base, 'Sources', 'b.md'), 'b');
    await writeFile(join(base, 'Sources', 'a.md'), 'a');
    await writeFile(join(base, 'Sources', 'a.sync-conflict-1.md'), 'x');
    await writeFile(join(base, 'Sources', 'ignora.txt'), 'x');
    expect(await listSourcePaths(base)).toEqual(['Sources/a.md', 'Sources/b.md']);
    expect(await listWikiPaths(base)).toEqual([]);
  });
});
