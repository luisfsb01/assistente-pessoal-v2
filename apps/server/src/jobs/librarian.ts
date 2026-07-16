import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import { getState, setState } from '../db/state.js';
import { indexFile } from '../knowledge/indexer.js';
import { listSourcePaths, listWikiPaths, readNoteRaw, writeWikiPage } from '../knowledge/vault.js';
import { noteNameFromPath } from '../tools/knowledge.js';

const STATE_KEY = 'librarian_state';
const MAX_POR_NOITE = 5; // proteção de custo: fontes restantes ficam para a próxima noite
const MAX_CHARS_FONTE = 8000;

type LibrarianState = { processed: string[] };

const librarianSchema = z.object({
  pages: z
    .array(z.object({ name: z.string(), content: z.string() }))
    .max(4)
    .describe('Páginas do Wiki a criar/atualizar (conteúdo markdown COMPLETO)'),
  index: z.string().describe('Conteúdo COMPLETO e atualizado do Index.md'),
});
type LibrarianResult = z.infer<typeof librarianSchema>;

export type LibrarianDeps = {
  listSourcePaths: typeof listSourcePaths;
  listWikiPaths: typeof listWikiPaths;
  readNoteRaw: (relPath: string) => Promise<string>;
  writeWikiPage: (name: string, content: string) => Promise<string>;
  indexFile: (relPath: string) => Promise<'indexed' | 'unchanged'>;
  getState: typeof getState;
  setState: typeof setState;
  generate: (opts: { purpose: 'librarian'; system: string; prompt: string; schema: z.Schema<LibrarianResult> }) => Promise<LibrarianResult>;
};

const defaultDeps: LibrarianDeps = {
  listSourcePaths,
  listWikiPaths,
  readNoteRaw: (p) => readNoteRaw(p),
  writeWikiPage: (n, c) => writeWikiPage(n, c),
  indexFile: (p) => indexFile(p),
  getState,
  setState,
  generate: (opts) => generateAgentObject(opts),
};

const SYSTEM = `Você é o bibliotecário de um segundo cérebro pessoal (método LLM Wiki).
Dada UMA fonte nova, atualize a wiki: crie/atualize as páginas de CONCEITOS e ENTIDADES afetadas (não uma página "sobre a fonte").
Regras:
- Páginas em PT-BR, nomes curtos de conceito (ex.: "Prompt Engineering"); trechos citados podem ficar no idioma original.
- Use [[links]] entre páginas e cite a fonte como [[nome-da-fonte]] onde usar o conteúdo dela.
- Devolva o conteúdo COMPLETO de cada página alterada (não um diff) e o Index.md COMPLETO atualizado (índice navegável por tema, com [[links]]).
- Poucas páginas e boas: no máximo 4 por fonte.`;

/** Ciclo noturno do bibliotecário: processa fontes novas e mantém o Wiki + Index. */
export async function runLibrarian(deps: LibrarianDeps = defaultDeps): Promise<{ processed: number; pages: number }> {
  const state = (await deps.getState<LibrarianState>(STATE_KEY)) ?? { processed: [] };
  const done = new Set(state.processed);
  const novas = (await deps.listSourcePaths()).filter((p) => !done.has(p)).slice(0, MAX_POR_NOITE);

  let processed = 0;
  let pages = 0;
  for (const sourcePath of novas) {
    try {
      const fonte = (await deps.readNoteRaw(sourcePath)).slice(0, MAX_CHARS_FONTE);
      const wikiPaths = await deps.listWikiPaths();
      const pageNames = wikiPaths.map(noteNameFromPath).filter((n) => n !== 'Index');
      const indexAtual = wikiPaths.includes('Wiki/Index.md') ? await deps.readNoteRaw('Wiki/Index.md') : '';

      const prompt = `Fonte nova: [[${noteNameFromPath(sourcePath)}]]
Conteúdo da fonte:
"""
${fonte}
"""

Páginas existentes no Wiki: ${pageNames.length > 0 ? pageNames.join(', ') : '(nenhuma ainda)'}

Index.md atual:
"""
${indexAtual || '(vazio)'}
"""`;

      const result = await deps.generate({ purpose: 'librarian', system: SYSTEM, prompt, schema: librarianSchema });

      for (const page of result.pages) {
        const rel = await deps.writeWikiPage(page.name, page.content);
        pages++;
        try {
          await deps.indexFile(rel);
        } catch (err) {
          console.error(`[librarian] indexação de ${rel} falhou (arquivo salvo):`, err);
        }
      }
      const relIndex = await deps.writeWikiPage('Index', result.index);
      try {
        await deps.indexFile(relIndex);
      } catch (err) {
        console.error('[librarian] indexação do Index falhou (arquivo salvo):', err);
      }

      state.processed.push(sourcePath);
      await deps.setState(STATE_KEY, state); // progresso durável por fonte
      processed++;
    } catch (err) {
      console.error(`[librarian] fonte ${sourcePath} falhou (fica para a próxima noite):`, err);
    }
  }
  return { processed, pages };
}
