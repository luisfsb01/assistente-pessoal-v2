import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import {
  saveKnowledgeContentFromHermes,
  saveKnowledgeUrlFromHermes,
  type KnowledgeMcpDeps,
} from './knowledge-tools.js';

function deps(over: Partial<KnowledgeMcpDeps> = {}): KnowledgeMcpDeps {
  let raw = '';
  return {
    extract: vi.fn(async (url, note) => ({
      kind: 'link',
      title: 'Podcast sobre excelência',
      markdown: `${url}\n\n${note ?? 'Resumo do episódio'}`,
    })),
    writeSourceNote: vi.fn(async (source) => {
      raw = `# ${source.title}\n\n${source.markdown}`;
      return 'Sources/2026-08-19-podcast-sobre-excelencia.md';
    }),
    readNoteRaw: vi.fn(async () => raw),
    indexFile: vi.fn(async () => 'indexed'),
    embed: vi.fn(async () => [0.1, 0.2]),
    search: vi.fn(async () => []),
    nowIso: () => '2026-08-19T21:00:00.000Z',
    ...over,
  };
}

describe('knowledge_save_content para o Hermes', () => {
  it('salva o conteúdo já resumido e só confirma depois de reler o arquivo', async () => {
    const fake = deps();
    const response = await saveKnowledgeContentFromHermes({
      title: 'Como parar de ser medíocre',
      content: 'Resumo completo do podcast com ideias e ações práticas.',
      source_url: 'https://podcast.example/episodio',
    }, fake);

    expect(fake.writeSourceNote).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Como parar de ser medíocre',
      markdown: 'Resumo completo do podcast com ideias e ações práticas.',
      url: 'https://podcast.example/episodio',
      origem: 'document',
    }));
    expect(fake.readNoteRaw).toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, indexed: true });
  });

  it('preserva e confirma a nota mesmo se a indexação falhar', async () => {
    const fake = deps({ indexFile: vi.fn(async () => { throw new Error('embedding indisponível'); }) });
    const response = await saveKnowledgeContentFromHermes({
      title: 'Resumo',
      content: 'Conteúdo suficientemente longo para ser salvo.',
    }, fake);

    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, indexed: false });
  });

  it('não afirma sucesso quando a releitura não contém o conteúdo', async () => {
    const fake = deps({ readNoteRaw: vi.fn(async () => '# outro conteúdo') });
    const response = await saveKnowledgeContentFromHermes({
      title: 'Resumo',
      content: 'Conteúdo que deveria ter sido persistido.',
    }, fake);

    expect(fake.indexFile).not.toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({
      ok: false,
      verified: false,
      error_code: 'verification_failed',
    });
  });
});

describe('knowledge_save_url para o Hermes', () => {
  it('mantém disponível o fluxo de captura direta por link', async () => {
    const fake = deps();
    const response = await saveKnowledgeUrlFromHermes({
      url: 'https://podcast.example/episodio',
      note: 'Revisar as ações sugeridas',
    }, fake);

    expect(fake.extract).toHaveBeenCalledWith('https://podcast.example/episodio', 'Revisar as ações sugeridas');
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, indexed: true });
  });
});
