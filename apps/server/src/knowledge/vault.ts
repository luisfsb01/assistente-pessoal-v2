import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../lib/config.js';

export type NoteOrigin = 'article' | 'youtube' | 'link' | 'document';

export type SourceNote = {
  title: string;
  url?: string;
  sourceFile?: string;
  origem: NoteOrigin;
  capturedAt: string; // ISO
  note?: string; // comentário do Luis na captura
  markdown: string; // corpo extraído
};

/** Slug estável para nome de arquivo: sem acento, sem pontuação, máx. 60. */
export function slugify(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'sem-titulo';
}

/** Arquivos de conflito do Syncthing nunca entram em listagem/índice. */
export function isSyncConflict(name: string): boolean {
  return name.includes('.sync-conflict');
}

/** Nome de página Wiki seguro para filesystem (mantém espaços — Obsidian usa no [[link]]). */
export function sanitizePageName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Sem nome';
}

/** Frontmatter YAML simples + corpo (Sources são imutáveis depois de escritas). */
export function buildSourceMarkdown(n: SourceNote): string {
  const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, ' ');
  return [
    '---',
    `title: "${esc(n.title)}"`,
    ...(n.url ? [`url: "${esc(n.url)}"`] : []),
    ...(n.sourceFile ? [`arquivo_original: "${esc(n.sourceFile)}"`] : []),
    `origem: ${n.origem}`,
    `captured_at: ${n.capturedAt}`,
    ...(n.note ? [`note: "${esc(n.note)}"`] : []),
    '---',
    '',
    n.markdown,
    '',
  ].join('\n');
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Grava a nota em Sources/YYYY-MM-DD-<slug>.md; colisão ganha -2, -3… Retorna o relPath. */
export async function writeSourceNote(n: SourceNote, base = getConfig().VAULT_PATH): Promise<string> {
  await mkdir(join(base, 'Sources'), { recursive: true });
  const dateRaw = n.capturedAt.slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);
  const slug = slugify(n.title);
  let rel = `Sources/${date}-${slug}.md`;
  for (let i = 2; await exists(join(base, rel)); i++) rel = `Sources/${date}-${slug}-${i}.md`;
  await writeFile(join(base, rel), buildSourceMarkdown(n), 'utf8');
  return rel;
}

/** Grava (cria/sobrescreve) uma página do Wiki. Retorna o relPath. */
export async function writeWikiPage(name: string, content: string, base = getConfig().VAULT_PATH): Promise<string> {
  await mkdir(join(base, 'Wiki'), { recursive: true });
  const rel = `Wiki/${sanitizePageName(name)}.md`;
  await writeFile(join(base, rel), content, 'utf8');
  return rel;
}

async function listDir(sub: 'Sources' | 'Wiki', base: string): Promise<string[]> {
  try {
    const names = await readdir(join(base, sub));
    return names
      .filter((f) => f.endsWith('.md') && !isSyncConflict(f))
      .sort()
      .map((f) => `${sub}/${f}`);
  } catch {
    return []; // pasta ainda não existe
  }
}

export async function listSourcePaths(base = getConfig().VAULT_PATH): Promise<string[]> {
  return listDir('Sources', base);
}

export async function listWikiPaths(base = getConfig().VAULT_PATH): Promise<string[]> {
  return listDir('Wiki', base);
}

export async function readNoteRaw(relPath: string, base = getConfig().VAULT_PATH): Promise<string> {
  return readFile(join(base, relPath), 'utf8');
}
