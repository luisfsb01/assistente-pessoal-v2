import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import { getState, setState } from '../db/state.js';
import { indexFile } from '../knowledge/indexer.js';
import { listSourcePaths, listWikiPaths, readNoteRaw, writeWikiPage } from '../knowledge/vault.js';
import { noteNameFromPath } from '../tools/knowledge.js';

const STATE_KEY = 'librarian_state';
const MAX_POR_NOITE = 5; // proteção de custo: fontes restantes ficam para a próxima noite
const MAX_CHARS_FONTE = 8000;
const MAX_CHARS_PAGINA = 1200; // corpo de página existente incluído no prompt (truncado)
const MAX_PAGINAS_NO_PROMPT = 20; // acima disso, as demais entram só pelo nome

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
- Ao ATUALIZAR uma página existente, parta do conteúdo atual dela mostrado no prompt: preserve o que continua válido e INTEGRE o novo — nunca reescreva do zero perdendo o acumulado.
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
      const indexAtual = wikiPaths.includes('Wiki/Index.md') ? await deps.readNoteRaw('Wiki/Index.md') : '';

      const paginasNoPrompt = wikiPaths.filter((p) => p !== 'Wiki/Index.md').slice(0, MAX_PAGINAS_NO_PROMPT);
      const corpos: string[] = [];
      for (const p of paginasNoPrompt) {
        const corpo = (await deps.readNoteRaw(p)).slice(0, MAX_CHARS_PAGINA);
        corpos.push(`### [[${noteNameFromPath(p)}]]\n${corpo}`);
      }
      const demais = wikiPaths.filter((p) => p !== 'Wiki/Index.md').slice(MAX_PAGINAS_NO_PROMPT).map(noteNameFromPath);
      const paginasBlock =
        corpos.length > 0
          ? `Páginas existentes no Wiki (conteúdo ATUAL — preserve o que continua válido ao atualizar):\n${corpos.join('\n\n')}${demais.length > 0 ? `\n\n(Outras páginas, só pelo nome: ${demais.join(', ')})` : ''}`
          : 'Páginas existentes no Wiki: (nenhuma ainda)';

      const prompt = `Fonte nova: [[${noteNameFromPath(sourcePath)}]]
Conteúdo da fonte:
"""
${fonte}
"""

${paginasBlock}

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
