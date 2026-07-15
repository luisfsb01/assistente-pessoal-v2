# Fase 6 — Segundo cérebro (vault + captura + bibliotecário + consulta): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vault markdown (Sources imutáveis + Wiki do agente) com captura por link no chat, bibliotecário noturno, busca semântica `knowledge_search` (pgvector) e sync via Syncthing.

**Architecture:** Arquivos são a fonte da verdade (pasta `VAULT_PATH`, bind mount no container; Syncthing roda no host). O índice `knowledge_index` (pgvector) é espelho derivado e reconstruível (`job:reindex-vault`). Captura: tool `knowledge_save` extrai a URL (readability/oEmbed; fallback link+nota — nunca falha por extração), grava `Sources/YYYY-MM-DD-<slug>.md` e indexa. Bibliotecário: cron 04:00, purpose novo `librarian` (modelo default), máx. 5 fontes/noite, cria/atualiza `Wiki/*.md` + `Index.md` e reindexa; Sources nunca são modificadas. Consulta: `knowledge_search` embeda a query e cita notas pelo nome.

**Tech Stack:** Node 22, TypeScript ESM NodeNext, `@mozilla/readability` + `jsdom` + `turndown` (novas deps), Vercel AI SDK v5 via `agent/models.ts`, Supabase PostgREST + pgvector, node-cron, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-fase6-segundo-cerebro-design.md`

## Global Constraints

- Imports relativos SEMPRE terminam em `.js` (ESM NodeNext); ponto e vírgula; aspas simples; strings/comentários em PT-BR.
- LLM só via `agent/models.ts`: bibliotecário usa purpose NOVO `librarian` (entra no union `Purpose`, FORA de `STRONG_PURPOSES` → modelo default); embeddings via `embedText` de `memory/embeddings.ts` (purpose `embedding` já registrado lá dentro). A captura NÃO faz chamada de LLM própria — a tool devolve título+trecho e o modelo do chat resume na resposta.
- O bot só escreve dentro de `VAULT_PATH`; nomes de arquivo SEMPRE derivados de slug/sanitização — nunca de input cru.
- `Sources/` é imutável (capturou, congelou); só o bibliotecário escreve em `Wiki/`.
- Arquivos `*.sync-conflict*` (Syncthing) são ignorados em toda listagem.
- Falhas degradam sem perder dado: extração ruim → nota link+nota; falha de embedding/índice → a nota fica salva (índice se reconstrói); falha do bibliotecário numa fonte → loga e segue (fonte fica para a próxima noite).
- Testes: vitest da raiz (`npx vitest run <caminho>`); teste que importe (mesmo transitivamente) `db/client.ts` tem `import '../test-setup.js';` como PRIMEIRO import; filesystem em pasta temporária (`fs.mkdtemp`), nunca rede.
- Crons existentes intocados; cron novo do bibliotecário: `0 4 * * *` (`cfg.TIMEZONE`).
- Fora de escopo: label do Gmail, PDFs, UI web (F8), integração com Projetos (F7).

### Interfaces já existentes que esta fase consome (verbatim do código atual)

- `lib/config.ts`: schema zod com `getConfig(): Config`; campos existentes incl. `EMBEDDING_MODEL_ID` default `text-embedding-3-small` (1536 dims).
- `memory/embeddings.ts`: `embedText(text: string): Promise<number[]>` (registra custo sozinho).
- `agent/models.ts`: `export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize' | 'judgment';`, `STRONG_PURPOSES = new Set(['briefing', 'analysis'])`, `pickModelId(purpose, status, cfg)`, `generateAgentObject(opts: { purpose; system; prompt; schema }, deps?)`.
- `agent/agent.ts`: `buildTools(identity: ChatIdentity): ToolSet` — spread de `saveMemoryTool()`, `buildTaskTools(identity)`, `buildShoppingTools(identity)`, `buildFinanceTools()`, calendário condicional.
- `agent/prompts.ts`: `buildSystemPrompt(args)` monta a const `capabilities` com bullets (`- Tarefas: ...`, `- Lista de compras: ...`, `- Finanças (do casal): ...`).
- `db/state.ts`: `getState<T>(key): Promise<T | null>`, `setState(key, value): Promise<void>`.
- `db/memories.ts` (padrão a espelhar em `db/knowledge.ts`): `searchMemories` usa `supabase.rpc('match_memories', { query_embedding, subjects, match_count })`.
- Padrão de tool (`tools/shopping.ts`): `buildXTools(identity?, deps = defaultDeps): ToolSet`, `tool({ description, inputSchema, execute })`, const `FAIL` PT-BR, try/catch por tool.
- `jobs/scheduler.ts`: crons com `cron.schedule(expr, fn, opts)` e `.catch(console.error)`; log final resume os jobs.
- `docker-stack.yml`: serviço `assistente-v2` com lista `environment:` (`- VAR=${VAR}`), `networks: [projetonet]`.

---

### Task 1: Migração 0005 + camada de dados (`db/knowledge.ts`) + config `VAULT_PATH`

**Files:**
- Create: `supabase/migrations/0005_fase6.sql`
- Create: `apps/server/src/db/knowledge.ts`
- Modify: `apps/server/src/lib/config.ts` (campo `VAULT_PATH`)
- Modify: `.env.example` (documentar `VAULT_PATH`)

**Interfaces:**
- Consumes: `supabase` de `./client.js`.
- Produces (usadas pelas Tasks 4 e 5):
  - `VAULT_PATH: string` no `Config` (default `./data/vault`).
  - `getIndexedFileHash(path: string): Promise<string | null>`
  - `replaceFileChunks(path: string, fileHash: string, chunks: Array<{ content: string; embedding: number[] }>): Promise<void>`
  - `deleteFileChunks(path: string): Promise<void>`
  - `searchKnowledge(embedding: number[], count?: number): Promise<Array<{ path: string; content: string; similarity: number }>>`

Nota: módulos `db/` não têm testes próprios neste repo (I/O puro; lógica testada nos consumidores com fakes).

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0005_fase6.sql`:

```sql
-- Fase 6: índice semântico do segundo cérebro (espelho derivado dos arquivos do vault)
create table knowledge_index (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  chunk_no int not null,
  content text not null,
  embedding vector(1536) not null,
  file_hash text not null,
  updated_at timestamptz not null default now(),
  unique (path, chunk_no)
);
create index knowledge_index_embedding_idx on knowledge_index using hnsw (embedding vector_cosine_ops);
alter table knowledge_index enable row level security;

create or replace function match_knowledge(
  query_embedding vector(1536),
  match_count int default 6
) returns table (path text, chunk_no int, content text, similarity float)
language sql stable as $$
  select k.path, k.chunk_no, k.content,
         1 - (k.embedding <=> query_embedding) as similarity
  from knowledge_index k
  order by k.embedding <=> query_embedding
  limit match_count;
$$;
```

(A migração NÃO é aplicada pelo implementer — o controlador aplica em produção no pós-merge. A extensão `vector` já existe desde a 0001.)

- [ ] **Step 2: Implementar `apps/server/src/db/knowledge.ts`**

```ts
import { supabase } from './client.js';

export type KnowledgeChunk = { content: string; embedding: number[] };
export type KnowledgeMatch = { path: string; content: string; similarity: number };

/** Hash do arquivo indexado (gravado em todo chunk; lido do chunk 0). Null = nunca indexado. */
export async function getIndexedFileHash(path: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('knowledge_index')
    .select('file_hash')
    .eq('path', path)
    .eq('chunk_no', 0)
    .maybeSingle();
  if (error) throw error;
  return (data?.file_hash as string | undefined) ?? null;
}

/** Reindexação atômica por arquivo: apaga os chunks antigos do path e grava os novos. */
export async function replaceFileChunks(
  path: string,
  fileHash: string,
  chunks: KnowledgeChunk[],
): Promise<void> {
  const del = await supabase.from('knowledge_index').delete().eq('path', path);
  if (del.error) throw del.error;
  if (chunks.length === 0) return;
  const rows = chunks.map((c, i) => ({
    path,
    chunk_no: i,
    content: c.content,
    embedding: c.embedding,
    file_hash: fileHash,
  }));
  const { error } = await supabase.from('knowledge_index').insert(rows);
  if (error) throw error;
}

export async function deleteFileChunks(path: string): Promise<void> {
  const { error } = await supabase.from('knowledge_index').delete().eq('path', path);
  if (error) throw error;
}

/** Busca semântica sobre Sources+Wiki (função match_knowledge da migração 0005). */
export async function searchKnowledge(embedding: number[], count = 6): Promise<KnowledgeMatch[]> {
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: embedding,
    match_count: count,
  });
  if (error) throw error;
  return (data ?? []).map((r: { path: string; content: string; similarity: number }) => ({
    path: r.path,
    content: r.content,
    similarity: r.similarity,
  }));
}
```

- [ ] **Step 3: Config e .env.example**

Em `apps/server/src/lib/config.ts`, adicionar ao schema (depois de `BANCO_MCP_TOKEN`):

```ts
  VAULT_PATH: z.string().default('./data/vault'),
```

Em `.env.example`, adicionar ao final:

```
# Fase 6: pasta do vault do segundo cérebro (no VPS: /vault via bind mount)
# VAULT_PATH=./data/vault
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_fase6.sql apps/server/src/db/knowledge.ts apps/server/src/lib/config.ts .env.example
git commit -m "feat(f6): knowledge_index (migração 0005) + camada de dados + VAULT_PATH"
```

---

### Task 2: Camada do vault (`knowledge/vault.ts`)

**Files:**
- Create: `apps/server/src/knowledge/vault.ts`
- Create: `apps/server/src/knowledge/vault.test.ts`

**Interfaces:**
- Consumes: `getConfig` de `../lib/config.js` (só no default do parâmetro `base`); `node:fs/promises`, `node:path`.
- Produces (usadas pelas Tasks 3, 4, 5, 6):
  - `type NoteOrigin = 'article' | 'youtube' | 'link'`
  - `type SourceNote = { title: string; url: string; origem: NoteOrigin; capturedAt: string; note?: string; markdown: string }`
  - `slugify(title: string): string` — PURA
  - `isSyncConflict(name: string): boolean` — PURA
  - `buildSourceMarkdown(n: SourceNote): string` — PURA (frontmatter + corpo)
  - `sanitizePageName(name: string): string` — PURA (nome de página Wiki seguro)
  - `writeSourceNote(n: SourceNote, base?: string): Promise<string>` — retorna relPath `Sources/...md`; colisão ganha sufixo `-2`, `-3`…
  - `writeWikiPage(name: string, content: string, base?: string): Promise<string>` — retorna relPath `Wiki/<nome>.md`
  - `listSourcePaths(base?: string): Promise<string[]>` / `listWikiPaths(base?: string): Promise<string[]>` — relPaths `.md`, sem sync-conflicts, ordenados; pasta ausente = `[]`
  - `readNoteRaw(relPath: string, base?: string): Promise<string>`

Todas as funções async recebem `base = getConfig().VAULT_PATH` como último parâmetro — nos testes passa-se uma pasta temporária e o config nunca é carregado (sem `test-setup`).

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/knowledge/vault.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/knowledge/vault.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/knowledge/vault.ts`:

```ts
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../lib/config.js';

export type NoteOrigin = 'article' | 'youtube' | 'link';

export type SourceNote = {
  title: string;
  url: string;
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
    `url: "${esc(n.url)}"`,
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
  const date = n.capturedAt.slice(0, 10);
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/knowledge/vault.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/knowledge
git commit -m "feat(f6): camada do vault (Sources/Wiki, slugs, frontmatter, sync-conflict)"
```

---

### Task 3: Extrator (`knowledge/extract.ts`) + novas dependências

**Files:**
- Modify: `apps/server/package.json` (deps novas — via npm install)
- Create: `apps/server/src/knowledge/extract.ts`
- Create: `apps/server/src/knowledge/extract.test.ts`

**Interfaces:**
- Consumes: `@mozilla/readability`, `jsdom`, `turndown`; `type NoteOrigin` da Task 2.
- Produces (usada pela Task 5):
  - `type Extracted = { kind: NoteOrigin; title: string; markdown: string }`
  - `type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>`
  - `detectKind(url: string): 'youtube' | 'article'` — PURA
  - `articleFromHtml(html: string, url: string): { title: string; markdown: string } | null` — PURA
  - `extractFromUrl(url: string, note: string | undefined, fetcher?: Fetcher): Promise<Extracted>` — NUNCA lança: qualquer falha degrada para `{ kind: 'link', ... }` com o link + a nota como corpo.

- [ ] **Step 1: Instalar dependências**

```bash
npm install @mozilla/readability jsdom turndown -w apps/server
npm install -D @types/jsdom @types/turndown -w apps/server
```

- [ ] **Step 2: Testes (falhando)**

`apps/server/src/knowledge/extract.test.ts` (sem `test-setup` — nada de `db/client.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { articleFromHtml, detectKind, extractFromUrl, type Fetcher } from './extract.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>Guia de Testes</title></head><body>
<article><h1>Guia de Testes</h1>${'<p>Parágrafo com conteúdo relevante sobre testes de software e boas práticas de engenharia.</p>'.repeat(10)}</article>
</body></html>`;

describe('detectKind', () => {
  it('youtube pelos domínios; resto é article', () => {
    expect(detectKind('https://www.youtube.com/watch?v=abc123')).toBe('youtube');
    expect(detectKind('https://youtu.be/abc123')).toBe('youtube');
    expect(detectKind('https://example.com/post')).toBe('article');
  });
});

describe('articleFromHtml', () => {
  it('extrai título e markdown do conteúdo principal', () => {
    const out = articleFromHtml(ARTICLE_HTML, 'https://example.com/post');
    expect(out).not.toBeNull();
    expect(out!.title).toContain('Guia de Testes');
    expect(out!.markdown).toContain('conteúdo relevante');
    expect(out!.markdown).not.toContain('<p>');
  });
  it('html pobre demais retorna null (vai para fallback)', () => {
    expect(articleFromHtml('<html><body><p>oi</p></body></html>', 'https://x.com')).toBeNull();
  });
});

describe('extractFromUrl', () => {
  it('artigo: usa o fetcher e devolve kind article', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, text: async () => ARTICLE_HTML });
    const out = await extractFromUrl('https://example.com/post', undefined, fetcher);
    expect(out.kind).toBe('article');
    expect(out.title).toContain('Guia de Testes');
  });

  it('youtube: título via oEmbed; sem legenda, corpo tem o link e o autor', async () => {
    const fetcher: Fetcher = async (url) => {
      if (url.includes('oembed'))
        return { ok: true, text: async () => JSON.stringify({ title: 'Vídeo Top', author_name: 'Canal X' }) };
      return { ok: true, text: async () => '<html>sem captionTracks aqui</html>' };
    };
    const out = await extractFromUrl('https://youtu.be/abc123', undefined, fetcher);
    expect(out.kind).toBe('youtube');
    expect(out.title).toBe('Vídeo Top');
    expect(out.markdown).toContain('Canal X');
    expect(out.markdown).toContain('https://youtu.be/abc123');
  });

  it('youtube com legenda: transcrição entra no corpo', async () => {
    const watchHtml = '{"captionTracks":[{"baseUrl":"https://yt.example/cap?lang=pt","languageCode":"pt"}]}';
    const fetcher: Fetcher = async (url) => {
      if (url.includes('oembed')) return { ok: true, text: async () => JSON.stringify({ title: 'V', author_name: 'C' }) };
      if (url.includes('yt.example/cap'))
        return { ok: true, text: async () => '<transcript><text start="0">Olá &amp; bem-vindos</text><text start="2">ao canal</text></transcript>' };
      return { ok: true, text: async () => watchHtml };
    };
    const out = await extractFromUrl('https://www.youtube.com/watch?v=abc', undefined, fetcher);
    expect(out.markdown).toContain('Transcrição');
    expect(out.markdown).toContain('Olá & bem-vindos ao canal');
  });

  it('falha de rede ou página pobre degrada para link+nota (nunca lança)', async () => {
    const fetcher: Fetcher = async () => {
      throw new Error('rede fora');
    };
    const out = await extractFromUrl('https://podcast.example/ep42', 'episódio sobre hábitos', fetcher);
    expect(out.kind).toBe('link');
    expect(out.markdown).toContain('https://podcast.example/ep42');
    expect(out.markdown).toContain('episódio sobre hábitos');
    expect(out.title).toBe('episódio sobre hábitos');
  });

  it('fallback sem nota usa o hostname como título', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, text: async () => '' });
    const out = await extractFromUrl('https://blog.example.com/x', undefined, fetcher);
    expect(out.kind).toBe('link');
    expect(out.title).toBe('blog.example.com');
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/knowledge/extract.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar**

`apps/server/src/knowledge/extract.ts`:

```ts
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import type { NoteOrigin } from './vault.js';

export type Extracted = { kind: NoteOrigin; title: string; markdown: string };

export type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (assistente-pessoal-v2)' },
    signal: AbortSignal.timeout(15_000),
  });

/** PURA: youtube.com/youtu.be viram 'youtube'; o resto tenta artigo. */
export function detectKind(url: string): 'youtube' | 'article' {
  const host = new URL(url).hostname.replace(/^(www\.|m\.)/, '');
  return host === 'youtube.com' || host === 'youtu.be' ? 'youtube' : 'article';
}

/** PURA: HTML → título + markdown do conteúdo principal (modo leitura). Null = extração pobre. */
export function articleFromHtml(html: string, url: string): { title: string; markdown: string } | null {
  const dom = new JSDOM(html, { url });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed?.content) return null;
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const markdown = turndown.turndown(parsed.content).trim();
  if (markdown.length < 200) return null; // pobre demais: melhor guardar só o link
  return { title: (parsed.title || url).trim(), markdown };
}

/** Legendas do YouTube (XML) → texto corrido. */
function captionsXmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractYoutube(url: string, fetcher: Fetcher): Promise<{ title: string; markdown: string } | null> {
  const res = await fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!res.ok) return null;
  const meta = JSON.parse(await res.text()) as { title?: string; author_name?: string };
  const title = meta.title ?? url;

  // Transcrição é melhor esforço: legendas públicas da página do vídeo, se existirem
  let transcript = '';
  try {
    const page = await fetcher(url);
    if (page.ok) {
      const m = (await page.text()).match(/"captionTracks":\s*(\[.*?\])/);
      if (m) {
        const tracks = JSON.parse(m[1]) as Array<{ baseUrl: string; languageCode?: string }>;
        const track =
          tracks.find((t) => t.languageCode?.startsWith('pt')) ??
          tracks.find((t) => t.languageCode?.startsWith('en')) ??
          tracks[0];
        if (track?.baseUrl) {
          const cap = await fetcher(track.baseUrl.replace(/\\u0026/g, '&'));
          if (cap.ok) transcript = captionsXmlToText(await cap.text());
        }
      }
    }
  } catch (err) {
    console.error('[extract] transcrição do YouTube falhou (seguindo sem):', err);
  }

  const markdown = [
    `Vídeo de ${meta.author_name ?? 'autor desconhecido'}: ${url}`,
    ...(transcript ? ['', '## Transcrição', '', transcript] : []),
  ].join('\n');
  return { title, markdown };
}

/** Extrai a URL para virar nota. NUNCA lança: falha degrada para link+nota. */
export async function extractFromUrl(
  url: string,
  note: string | undefined,
  fetcher: Fetcher = defaultFetcher,
): Promise<Extracted> {
  try {
    if (detectKind(url) === 'youtube') {
      const yt = await extractYoutube(url, fetcher);
      if (yt) return { kind: 'youtube', ...yt };
    } else {
      const res = await fetcher(url);
      if (res.ok) {
        const art = articleFromHtml(await res.text(), url);
        if (art) return { kind: 'article', ...art };
      }
    }
  } catch (err) {
    console.error('[extract] extração falhou (salvando como link):', err);
  }
  // Fallback: guarda o link e a nota do Luis — captura nunca falha por extração
  const title = note?.trim() ? note.trim().slice(0, 60) : new URL(url).hostname;
  const markdown = [url, ...(note ? ['', note] : [])].join('\n');
  return { kind: 'link', title, markdown };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/server/src/knowledge/extract.test.ts`
Expected: PASS. (Se `articleFromHtml` do fixture falhar por detalhe do Readability, ajuste o FIXTURE — mais parágrafos — nunca o limiar de 200.)

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/package.json package-lock.json apps/server/src/knowledge
git commit -m "feat(f6): extrator de conteúdo (readability, youtube oembed+legendas, fallback link+nota)"
```

---

### Task 4: Indexador (`knowledge/indexer.ts`) + script de reindex

**Files:**
- Create: `apps/server/src/knowledge/indexer.ts`
- Create: `apps/server/src/knowledge/indexer.test.ts`
- Create: `apps/server/src/scripts/reindex-vault.ts`
- Modify: `apps/server/package.json` (script `job:reindex-vault`)

**Interfaces:**
- Consumes: `getIndexedFileHash`, `replaceFileChunks` (Task 1); `listSourcePaths`, `listWikiPaths`, `readNoteRaw` (Task 2); `embedText` de `../memory/embeddings.js`.
- Produces (usadas pelas Tasks 5 e 6):
  - `chunkMarkdown(text: string, maxLen?: number): string[]` — PURA
  - `hashText(text: string): string` — PURA (sha256 hex)
  - `type IndexerDeps = { readNoteRaw: (relPath: string) => Promise<string>; getIndexedFileHash: typeof getIndexedFileHash; replaceFileChunks: typeof replaceFileChunks; embed: (text: string) => Promise<number[]> }`
  - `indexFile(relPath: string, deps?: IndexerDeps): Promise<'indexed' | 'unchanged'>`
  - `reindexVault(deps?: IndexerDeps & { listSourcePaths: typeof listSourcePaths; listWikiPaths: typeof listWikiPaths }): Promise<{ indexed: number; unchanged: number; failed: number }>`

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/knowledge/indexer.test.ts` (o `test-setup` vem primeiro: importa `db/knowledge.js` → `db/client.ts`):

```ts
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/knowledge/indexer.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/knowledge/indexer.ts`:

```ts
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
```

`apps/server/src/scripts/reindex-vault.ts`:

```ts
// Reconstrói o índice semântico a partir dos arquivos do vault
// (uso: npm run job:reindex-vault -w apps/server)
import { reindexVault } from '../knowledge/indexer.js';

const out = await reindexVault();
console.log(`reindex: ${out.indexed} indexados, ${out.unchanged} inalterados, ${out.failed} falhas`);
```

Em `apps/server/package.json`, adicionar aos `scripts` (depois de `"job:email-cleanup"`, atenção à vírgula):

```json
    "job:reindex-vault": "tsx src/scripts/reindex-vault.ts"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/knowledge/indexer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/knowledge apps/server/src/scripts/reindex-vault.ts apps/server/package.json
git commit -m "feat(f6): indexador (chunking, hash, reindex reconstruível) + script manual"
```

---

### Task 5: Tools do agente (`tools/knowledge.ts`) + registro + prompt

**Files:**
- Create: `apps/server/src/tools/knowledge.ts`
- Create: `apps/server/src/tools/knowledge.test.ts`
- Modify: `apps/server/src/agent/agent.ts` (registrar em `buildTools`)
- Modify: `apps/server/src/agent/prompts.ts` (bullet do segundo cérebro em `capabilities`)

**Interfaces:**
- Consumes: `extractFromUrl` (Task 3); `writeSourceNote` (Task 2); `indexFile` (Task 4); `searchKnowledge` (Task 1); `embedText`.
- Produces: `buildKnowledgeTools(deps?: KnowledgeToolDeps): ToolSet` com tools `knowledge_save` e `knowledge_search`.

**Comportamento:**
- `knowledge_save(url, note?)`: extrai → grava em Sources → indexa (falha de índice só loga — a nota é a verdade) → devolve JSON `{ salvo, titulo, tipo, trecho }` (trecho = primeiros 600 chars do corpo) para o modelo do chat resumir. SEM chamada de LLM própria.
- `knowledge_search(query)`: embeda a query → `searchKnowledge` → devolve JSON de `{ nota, trecho }` (nota = nome do arquivo sem pasta/extensão) para o agente citar como `[[nota]]`. Vazio → mensagem PT-BR dizendo que não há nada salvo sobre isso.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/tools/knowledge.test.ts` (o `test-setup` vem primeiro: importa módulos que carregam `db/client.ts`):

```ts
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/tools/knowledge.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/tools/knowledge.ts`:

```ts
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
```

Em `apps/server/src/agent/agent.ts`:
- Adicionar o import `import { buildKnowledgeTools } from '../tools/knowledge.js';` (junto aos outros de tools).
- Em `buildTools`, adicionar `...buildKnowledgeTools(),` logo depois de `...buildFinanceTools(),`.

Em `apps/server/src/agent/prompts.ts`, dentro da template string `capabilities`, adicionar este bullet logo após a linha `- Finanças (do casal): ...` (mesma indentação dos vizinhos):

```
- Segundo cérebro (do casal): quando o usuário mandar um link pedindo para salvar/guardar, use knowledge_save (com a nota/comentário dele, se houver) e responda com um resumo curto do que foi salvo. Para perguntas sobre conteúdo já salvo, use knowledge_search e cite as notas pelo nome entre [[colchetes duplos]].
```

- [ ] **Step 4: Rodar e ver passar (novos + agente/prompts)**

Run: `npx vitest run apps/server/src/tools/knowledge.test.ts apps/server/src/agent`
Expected: PASS em tudo (os testes existentes de agent/prompts não dependem da lista exata de tools/bullets).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/tools/knowledge.ts apps/server/src/tools/knowledge.test.ts apps/server/src/agent/agent.ts apps/server/src/agent/prompts.ts
git commit -m "feat(f6): tools knowledge_save/knowledge_search + registro no agente e no prompt"
```

---

### Task 6: Bibliotecário (`jobs/librarian.ts`) + purpose `librarian`

**Files:**
- Modify: `apps/server/src/agent/models.ts` (linha do `export type Purpose`)
- Modify: `apps/server/src/agent/models.test.ts` (1 teste novo)
- Create: `apps/server/src/jobs/librarian.ts`
- Create: `apps/server/src/jobs/librarian.test.ts`
- Create: `apps/server/src/scripts/run-librarian.ts`
- Modify: `apps/server/package.json` (script `job:librarian`)

**Interfaces:**
- Consumes: `generateAgentObject`; `getState`/`setState`; `listSourcePaths`, `listWikiPaths`, `readNoteRaw`, `writeWikiPage` (Task 2); `indexFile` (Task 4); `noteNameFromPath` (Task 5).
- Produces (usada pela Task 7): `runLibrarian(deps?: LibrarianDeps): Promise<{ processed: number; pages: number }>`.

**Comportamento:**
1. Estado `app_state['librarian_state'] = { processed: string[] }` (relPaths de Sources já processados).
2. Fontes novas = `listSourcePaths()` fora de `processed`, limitadas a `MAX_POR_NOITE = 5` (proteção de custo), mais antigas primeiro (a listagem já vem ordenada).
3. Para cada fonte: lê o conteúdo (truncado em 8000 chars), lê nomes das páginas Wiki existentes e o `Index.md` atual (vazio se não existir) → `generateAgentObject` (purpose `librarian`, modelo default) devolve `{ pages: [{ name, content }], index }` — conteúdo COMPLETO das páginas afetadas (máx. 4 por fonte no schema) e o Index.md completo atualizado.
4. Grava cada página + `Index` via `writeWikiPage`, indexa cada arquivo gravado (`indexFile`, falha só loga), marca a fonte como processada e SALVA o estado imediatamente (progresso durável por fonte).
5. Falha numa fonte (LLM/IO): loga e segue para a próxima; a fonte fica para a noite seguinte. Sources NUNCA são escritas.

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/agent/models.test.ts`, junto aos testes de `pickModelId` (siga o padrão de nome de variável do arquivo):

```ts
  it('librarian usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('librarian', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
```

`apps/server/src/jobs/librarian.test.ts` (o `test-setup` vem primeiro):

```ts
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
      readNoteRaw: async (p) => (p === 'Wiki/Index.md' ? '# Índice atual' : 'texto da fonte X'),
      generate: async (opts: { prompt: string }) => {
        seen = opts.prompt;
        return { pages: [], index: '# I' } as never;
      },
    });
    await runLibrarian(d);
    expect(seen).toContain('texto da fonte X');
    expect(seen).toContain('Hábitos');
    expect(seen).toContain('# Índice atual');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/jobs/librarian.test.ts`
Expected: FAIL — purpose inexistente; módulo librarian não existe.

- [ ] **Step 3: Implementar**

Em `apps/server/src/agent/models.ts`:

```ts
export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize' | 'judgment' | 'librarian';
```

(`STRONG_PURPOSES` não muda.)

`apps/server/src/jobs/librarian.ts`:

```ts
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
```

`apps/server/src/scripts/run-librarian.ts`:

```ts
// Roda o bibliotecário manualmente (uso: npm run job:librarian -w apps/server)
import { runLibrarian } from '../jobs/librarian.js';

const out = await runLibrarian();
console.log(`bibliotecário: ${out.processed} fontes processadas, ${out.pages} páginas do wiki`);
```

Em `apps/server/package.json`, adicionar aos `scripts` (depois de `"job:reindex-vault"`, atenção à vírgula):

```json
    "job:librarian": "tsx src/scripts/run-librarian.ts"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/jobs/librarian.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/agent/models.ts apps/server/src/agent/models.test.ts apps/server/src/jobs/librarian.ts apps/server/src/jobs/librarian.test.ts apps/server/src/scripts/run-librarian.ts apps/server/package.json
git commit -m "feat(f6): bibliotecário noturno (purpose librarian, wiki incremental, teto por noite)"
```

---

### Task 7: Cron, Docker, SETUP.md §8 e verificação final

**Files:**
- Modify: `apps/server/src/jobs/scheduler.ts` (cron do bibliotecário)
- Modify: `docker-stack.yml` (env `VAULT_PATH` + bind mount)
- Modify: `SETUP.md` (seção "8. Fase 6")

**Interfaces:**
- Consumes: `runLibrarian` (Task 6); scheduler atual (crons existentes INTOCADOS).
- Produces: bibliotecário agendado 04:00; vault persistente no host do VPS; doc do Syncthing.

- [ ] **Step 1: Editar `apps/server/src/jobs/scheduler.ts`**

Adicionar o import:

```ts
import { runLibrarian } from './librarian.js';
```

Depois do bloco do cron da limpeza do Gmail, adicionar:

```ts
  // Bibliotecário do segundo cérebro (Fase 6): processa fontes novas de madrugada
  cron.schedule('0 4 * * *', () => {
    runLibrarian().catch((err) => console.error('[job:librarian]', err));
  }, opts);
```

E no `console.log` final, acrescentar `bibliotecário 04:00` logo depois de `revisão financeira 08:00,` (mantendo o resto da linha igual):

```ts
  console.log(
    `[scheduler] reflexão 03:00, bibliotecário 04:00, revisão financeira 08:00, briefing 07:00 (+casal sáb 08:00), coletores: calendário ${hasGoogleCreds(cfg) ? '30min' : 'off'}, banco ${isBankConfigured() ? '2h' : 'off'}, tarefas 06:30, gmail ${hasGoogleCreds(cfg) ? '30min' : 'off'} — ${cfg.TIMEZONE}`,
  );
```

- [ ] **Step 2: Docker (`docker-stack.yml`)**

No serviço `assistente-v2`:
- Adicionar à lista `environment:` (depois de `- PORT=8080`):

```yaml
      - VAULT_PATH=/vault
```

- Adicionar (mesmo nível de `environment:`/`networks:`):

```yaml
    volumes:
      - /root/assistente-vault:/vault
```

- [ ] **Step 3: SETUP.md** — adicionar seção ao final (depois da seção 7, antes de "Notas"):

```markdown
## 8. Fase 6 (segundo cérebro: vault + Syncthing + Obsidian)

1. **Migração**: executar `supabase/migrations/0005_fase6.sql` (SQL Editor ou
   Management API).
2. **Pasta do vault no VPS** (terminal do navegador da Hostinger):
   ```bash
   mkdir -p /root/assistente-vault
   ```
   O deploy monta essa pasta dentro do container como `/vault`
   (variável `VAULT_PATH`). Nada a configurar no `.env` do VPS.
3. **Testar a captura**: mandar um link de artigo no chat do bot pedindo para
   salvar → a nota aparece em `/root/assistente-vault/Sources/`. O
   bibliotecário roda às 04:00 (ou `npm run job:librarian -w apps/server`).
4. **Syncthing** (espelha o vault no PC e no celular — passo a passo leigo):

   *O que é:* um programa que mantém a MESMA pasta igualzinha em vários
   aparelhos, direto entre eles (sem nuvem de terceiros).

   **a) No VPS:**
   ```bash
   apt install -y syncthing
   systemctl enable --now syncthing@root
   # liberar a GUI só para configurar (senha primeiro!):
   syncthing cli config gui raw-address set 0.0.0.0:8384
   systemctl restart syncthing@root
   ```
   - No painel de firewall da Hostinger, liberar as portas **8384** (TCP,
     temporária, só para configurar) e **22000** (TCP e UDP, permanente).
   - Abrir `http://IP-DO-VPS:8384` no navegador → Actions → Settings → GUI →
     definir **usuário e senha** (obrigatório antes de qualquer outra coisa).
   - Actions → Show ID → esse é o **Device ID do VPS** (um QR/código longo).
   - Add Folder: Folder Path `/root/assistente-vault`, Label `vault`.
5. **No PC (Windows)**: instalar o [Syncthing](https://syncthing.net/downloads/)
   (ou SyncTrayzor). Abrir a GUI local → Add Remote Device → colar o Device
   ID do VPS → no VPS, aceitar o convite e **compartilhar a pasta `vault`**
   com o PC → no PC, aceitar a pasta e escolher um caminho (ex.:
   `C:\Users\LUIS BARBOSA\assistente-vault`).
6. **No celular**: Android → app "Syncthing-Fork" (Play Store); iPhone →
   "Möbius Sync" (App Store). Mesmo processo: parear com o Device ID do VPS
   e aceitar a pasta `vault`.
7. **Obsidian**: instalar no PC/celular e "Open folder as vault" apontando
   para a pasta sincronizada. `Sources/` = capturas; `Wiki/` = páginas do
   bibliotecário; comece por `Wiki/Index.md`.
8. Depois de tudo pareado, **fechar a porta 8384** no firewall (a GUI volta
   a ser local); a 22000 fica aberta (é a porta de sincronização).
9. **Recuperação do índice** (se precisar): `npm run job:reindex-vault -w apps/server`
   reconstrói a busca a partir dos arquivos.
```

- [ ] **Step 4: Rodar TODOS os testes e typecheck**

Run: `npx vitest run` (raiz)
Expected: PASS na suíte inteira (sem regressões).

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/jobs/scheduler.ts docker-stack.yml SETUP.md
git commit -m "feat(f6): cron do bibliotecário + bind mount do vault + setup do Syncthing"
```

---

## Pós-merge (operacional — controlador + Luis)

1. **Merge** na master local (finishing-a-development-branch, opção 1).
2. **Migração 0005** aplicada em produção pelo controlador (Management API) — pedir ok ao Luis.
3. **Luis:** `git push`; criar `/root/assistente-vault` no VPS; `FORCE=1 bash scripts/deploy-pull.sh`.
4. **UAT:**
   - Mandar link de artigo no chat → resumo na resposta; `.md` novo em `Sources/`.
   - Link de podcast com comentário → nota link+nota sem erro.
   - `npm run job:librarian` → páginas em `Wiki/` + `Index.md` citando a fonte.
   - Perguntar sobre o artigo no chat → resposta cita `[[nota]]`.
   - Syncthing/Obsidian (SETUP.md §8.4–8.8) — pode ser feito com calma depois.
