import {
  fromJsonSchema,
  type CallToolResult,
  type McpServer,
} from '@modelcontextprotocol/server';
import { searchKnowledge, type KnowledgeMatch } from '../db/knowledge.js';
import { extractFromUrl, type Extracted } from '../knowledge/extract.js';
import { indexFile } from '../knowledge/indexer.js';
import { readNoteRaw, writeSourceNote, type SourceNote } from '../knowledge/vault.js';
import { embedText } from '../memory/embeddings.js';

export type KnowledgeMcpDeps = {
  extract: (url: string, note?: string) => Promise<Extracted>;
  writeSourceNote: (note: SourceNote) => Promise<string>;
  readNoteRaw: (relPath: string) => Promise<string>;
  indexFile: (relPath: string) => Promise<'indexed' | 'unchanged'>;
  embed: (text: string) => Promise<number[]>;
  search: (embedding: number[]) => Promise<KnowledgeMatch[]>;
  nowIso: () => string;
};

const defaultDeps: KnowledgeMcpDeps = {
  extract: extractFromUrl,
  writeSourceNote: (note) => writeSourceNote(note),
  readNoteRaw: (relPath) => readNoteRaw(relPath),
  indexFile: (relPath) => indexFile(relPath),
  embed: embedText,
  search: (embedding) => searchKnowledge(embedding),
  nowIso: () => new Date().toISOString(),
};

function result(value: Record<string, unknown>, message?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message ?? JSON.stringify(value) }],
    structuredContent: value,
  };
}

function noteName(relPath: string): string {
  return relPath.replace(/^.*\//, '').replace(/\.md$/, '');
}

async function indexWithoutLosingNote(relPath: string, deps: KnowledgeMcpDeps): Promise<boolean> {
  try {
    await deps.indexFile(relPath);
    return true;
  } catch (error) {
    // O arquivo Markdown e a fonte da verdade; o indice pode ser refeito depois.
    console.error('[mcp] indexacao do segundo cerebro falhou (nota preservada):', error);
    return false;
  }
}

export async function saveKnowledgeContentFromHermes(
  input: { title: string; content: string; source_url?: string; note?: string },
  deps: KnowledgeMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  try {
    const content = input.content.trim();
    const relPath = await deps.writeSourceNote({
      title: input.title.trim(),
      url: input.source_url,
      origem: 'document',
      capturedAt: deps.nowIso(),
      note: input.note?.trim() || undefined,
      markdown: content,
    });
    const saved = await deps.readNoteRaw(relPath);
    const verified = saved.includes(content);
    if (!verified) {
      return result(
        { ok: false, verified: false, error_code: 'verification_failed', path: relPath },
        'O arquivo foi criado, mas o conteudo nao foi confirmado. Nao considere o salvamento concluido.',
      );
    }
    const indexed = await indexWithoutLosingNote(relPath, deps);
    return result(
      { ok: true, verified: true, indexed, path: relPath, note_name: noteName(relPath) },
      indexed
        ? `Conteudo salvo e conferido no segundo cerebro como [[${noteName(relPath)}]].`
        : `Conteudo salvo e conferido como [[${noteName(relPath)}]], mas a busca semantica sera atualizada depois.`,
    );
  } catch (error) {
    console.error('[mcp] knowledge_save_content falhou:', error);
    return result(
      { ok: false, verified: false, error_code: 'save_failed' },
      'Nao consegui salvar o conteudo no segundo cerebro agora.',
    );
  }
}

export async function saveKnowledgeUrlFromHermes(
  input: { url: string; note?: string },
  deps: KnowledgeMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  try {
    const extracted = await deps.extract(input.url, input.note);
    const relPath = await deps.writeSourceNote({
      title: extracted.title,
      url: input.url,
      origem: extracted.kind,
      capturedAt: deps.nowIso(),
      note: input.note?.trim() || undefined,
      markdown: extracted.markdown,
    });
    const saved = await deps.readNoteRaw(relPath);
    const verified = saved.includes(extracted.markdown);
    if (!verified) {
      return result({ ok: false, verified: false, error_code: 'verification_failed', path: relPath });
    }
    const indexed = await indexWithoutLosingNote(relPath, deps);
    return result({
      ok: true,
      verified: true,
      indexed,
      path: relPath,
      note_name: noteName(relPath),
      title: extracted.title,
      content: extracted.markdown.slice(0, 12_000),
      content_truncated: extracted.markdown.length > 12_000,
    });
  } catch (error) {
    console.error('[mcp] knowledge_save_url falhou:', error);
    return result({ ok: false, verified: false, error_code: 'save_failed' }, 'Nao consegui salvar esse link agora.');
  }
}

export function registerKnowledgeMcpTools(server: McpServer, deps: KnowledgeMcpDeps = defaultDeps): void {
  server.registerTool(
    'knowledge_save_content',
    {
      title: 'Salvar conteudo no segundo cerebro',
      description:
        'Salva texto ja presente na conversa no segundo cerebro real do Luis. Use para pedidos como "salve este/esse conteudo", inclusive resumos de podcasts. Nao use terminal nem procure um vault do Obsidian.',
      inputSchema: fromJsonSchema<{ title: string; content: string; source_url?: string; note?: string }>({
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 300 },
          content: { type: 'string', minLength: 10, maxLength: 120000 },
          source_url: { type: 'string', pattern: '^https?://', maxLength: 2048 },
          note: { type: 'string', maxLength: 2000 },
        },
        required: ['title', 'content'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => saveKnowledgeContentFromHermes(input, deps),
  );

  server.registerTool(
    'knowledge_save_url',
    {
      title: 'Salvar link no segundo cerebro',
      description: 'Extrai e salva um artigo, video, podcast ou outro link no segundo cerebro real do Luis.',
      inputSchema: fromJsonSchema<{ url: string; note?: string }>({
        type: 'object',
        properties: {
          url: { type: 'string', pattern: '^https?://', maxLength: 2048 },
          note: { type: 'string', maxLength: 2000 },
        },
        required: ['url'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => saveKnowledgeUrlFromHermes(input, deps),
  );

  server.registerTool(
    'knowledge_search',
    {
      title: 'Buscar no segundo cerebro',
      description: 'Busca semanticamente nas notas e no wiki do segundo cerebro real do Luis.',
      inputSchema: fromJsonSchema<{ query: string }>({
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 1000 } },
        required: ['query'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        const matches = await deps.search(await deps.embed(query));
        return result({
          ok: true,
          matches: matches.map((match) => ({
            note: noteName(match.path),
            path: match.path,
            excerpt: match.content.slice(0, 700),
            similarity: match.similarity,
          })),
        });
      } catch (error) {
        console.error('[mcp] knowledge_search falhou:', error);
        return result({ ok: false, error_code: 'search_failed' }, 'Nao consegui buscar no segundo cerebro agora.');
      }
    },
  );
}
