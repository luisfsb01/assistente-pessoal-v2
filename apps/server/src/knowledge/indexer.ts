import { createHash } from 'node:crypto';
import { getIndexedFileHash, replaceFileChunks } from '../db/knowledge.js';
import { embedText } from '../memory/embeddings.js';
import { listSourcePaths, listWikiPaths, readNoteRaw } from './vault.js';

/** PURA: agrupa parágrafos até maxLen; parágrafo gigante é cortado duro. */
export function chunkMarkdown(text: string, maxLen = 1200): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const p of text.split(/\n{2,}/)) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > maxLen) {
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (let i = 0; i < para.length; i += maxLen) chunks.push(para.slice(i, i + maxLen));
      continue;
    }
    if (cur && cur.length + para.length + 2 > maxLen) {
      chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type IndexerDeps = {
  readNoteRaw: (relPath: string) => Promise<string>;
  getIndexedFileHash: typeof getIndexedFileHash;
  replaceFileChunks: typeof replaceFileChunks;
  embed: (text: string) => Promise<number[]>;
};

const defaultDeps: IndexerDeps = {
  readNoteRaw: (p) => readNoteRaw(p),
  getIndexedFileHash,
  replaceFileChunks,
  embed: embedText,
};

/** (Re)indexa um arquivo do vault; pula se o hash não mudou. */
export async function indexFile(relPath: string, deps: IndexerDeps = defaultDeps): Promise<'indexed' | 'unchanged'> {
  const raw = await deps.readNoteRaw(relPath);
  const hash = hashText(raw);
  if ((await deps.getIndexedFileHash(relPath)) === hash) return 'unchanged';
  const chunks: Array<{ content: string; embedding: number[] }> = [];
  for (const content of chunkMarkdown(raw)) chunks.push({ content, embedding: await deps.embed(content) });
  await deps.replaceFileChunks(relPath, hash, chunks);
  return 'indexed';
}

export type ReindexDeps = IndexerDeps & {
  listSourcePaths: typeof listSourcePaths;
  listWikiPaths: typeof listWikiPaths;
};

const defaultReindexDeps: ReindexDeps = { ...defaultDeps, listSourcePaths, listWikiPaths };

/** Reconstrução do índice a partir dos arquivos (recuperação/manutenção). */
export async function reindexVault(
  deps: ReindexDeps = defaultReindexDeps,
): Promise<{ indexed: number; unchanged: number; failed: number }> {
  const paths = [...(await deps.listSourcePaths()), ...(await deps.listWikiPaths())];
  let indexed = 0;
  let unchanged = 0;
  let failed = 0;
  for (const p of paths) {
    try {
      if ((await indexFile(p, deps)) === 'indexed') indexed++;
      else unchanged++;
    } catch (err) {
      failed++;
      console.error(`[indexer] falha em ${p} (seguindo):`, err);
    }
  }
  return { indexed, unchanged, failed };
}
