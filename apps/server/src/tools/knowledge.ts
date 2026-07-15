import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { searchKnowledge, type KnowledgeMatch } from '../db/knowledge.js';
import { extractFromUrl, type Extracted } from '../knowledge/extract.js';
import { indexFile } from '../knowledge/indexer.js';
import { writeSourceNote, type SourceNote } from '../knowledge/vault.js';
import { embedText } from '../memory/embeddings.js';

export type KnowledgeToolDeps = {
  extract: (url: string, note: string | undefined) => Promise<Extracted>;
  writeSourceNote: (n: SourceNote) => Promise<string>;
  indexFile: (relPath: string) => Promise<'indexed' | 'unchanged'>;
  embed: (text: string) => Promise<number[]>;
  search: (embedding: number[]) => Promise<KnowledgeMatch[]>;
  nowIso: () => string;
};

const defaultDeps: KnowledgeToolDeps = {
  extract: extractFromUrl,
  writeSourceNote: (n) => writeSourceNote(n),
  indexFile: (p) => indexFile(p),
  embed: embedText,
  search: (e) => searchKnowledge(e),
  nowIso: () => new Date().toISOString(),
};

const FAIL = 'Não consegui salvar/buscar no segundo cérebro agora. Tenta de novo em instantes.';

/** Nome citável da nota: sem pasta, sem .md (vira [[nota]] no Obsidian). */
export function noteNameFromPath(relPath: string): string {
  return relPath.replace(/^.*\//, '').replace(/\.md$/, '');
}

export function buildKnowledgeTools(deps: KnowledgeToolDeps = defaultDeps): ToolSet {
  return {
    knowledge_save: tool({
      description:
        'Salva um link (artigo, vídeo do YouTube, podcast etc.) no segundo cérebro do casal. Use quando o usuário mandar uma URL pedindo para salvar/guardar. A nota opcional é o comentário do usuário sobre o conteúdo.',
      inputSchema: z.object({
        url: z.string().url(),
        note: z.string().optional().describe('Comentário do usuário sobre o link, se houver'),
      }),
      execute: async ({ url, note }) => {
        try {
          const ex = await deps.extract(url, note);
          const relPath = await deps.writeSourceNote({
            title: ex.title,
            url,
            origem: ex.kind,
            capturedAt: deps.nowIso(),
            note,
            markdown: ex.markdown,
          });
          try {
            await deps.indexFile(relPath);
          } catch (err) {
            // a nota é a verdade; o índice se reconstrói (job:reindex-vault)
            console.error('[knowledge] indexação falhou (nota salva mesmo assim):', err);
          }
          return JSON.stringify({
            salvo: relPath,
            titulo: ex.title,
            tipo: ex.kind,
            trecho: ex.markdown.slice(0, 600),
          });
        } catch {
          return FAIL;
        }
      },
    }),
    knowledge_search: tool({
      description:
        'Busca no segundo cérebro (artigos, vídeos e notas salvas + wiki). Use quando o usuário perguntar sobre algo que pode ter sido salvo. Cite as notas pelo nome nas respostas.',
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => {
        try {
          const matches = await deps.search(await deps.embed(query));
          if (matches.length === 0) return 'Nada salvo no segundo cérebro sobre isso.';
          return JSON.stringify(
            matches.map((m) => ({ nota: noteNameFromPath(m.path), trecho: m.content.slice(0, 500) })),
          );
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
