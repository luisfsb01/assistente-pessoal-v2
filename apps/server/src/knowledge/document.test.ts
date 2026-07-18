import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import {
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  knowledgeDocumentTitle,
  saveKnowledgeDocument,
  supportedKnowledgeDocumentName,
  type KnowledgeDocumentDeps,
} from './document.js';
import { extractKnowledgeDocumentText } from './document-extract.js';
import type { SourceNote } from './vault.js';

const luis: ChatIdentity = {
  chatId: 123,
  kind: 'private',
  userName: 'Luis',
  subject: 'luis',
};

function deps(identity: ChatIdentity | null = luis) {
  const saved: SourceNote[] = [];
  const indexed: string[] = [];
  const d: KnowledgeDocumentDeps = {
    getChatIdentity: async () => identity,
    writeSourceNote: async (note) => {
      saved.push(note);
      return 'Sources/2026-07-18-guia-syncthing.md';
    },
    indexFile: async (relPath) => {
      indexed.push(relPath);
      return 'indexed';
    },
    extractText: extractKnowledgeDocumentText,
    nowIso: () => '2026-07-18T22:03:00.000Z',
  };
  return { d, saved, indexed };
}

function incoming(over: Partial<Parameters<typeof saveKnowledgeDocument>[0]> = {}) {
  return {
    chatId: 123,
    senderId: 123,
    fileName: 'guia-syncthing.md',
    mimeType: 'text/markdown',
    fileSize: 18,
    download: async () => new TextEncoder().encode('# Guia\n\nConteúdo.'),
    ...over,
  };
}

describe('nomes de documentos do segundo cérebro', () => {
  it('aceita os formatos suportados e remove qualquer caminho do nome', () => {
    expect(supportedKnowledgeDocumentName('guia.md')).toBe('guia.md');
    expect(supportedKnowledgeDocumentName('C:\\temp\\guia.markdown')).toBe('guia.markdown');
    expect(supportedKnowledgeDocumentName('../notas/guia.txt')).toBe('guia.txt');
    expect(supportedKnowledgeDocumentName('arquivo.pdf')).toBe('arquivo.pdf');
    expect(supportedKnowledgeDocumentName('arquivo.docx')).toBe('arquivo.docx');
    expect(supportedKnowledgeDocumentName('arquivo.doc')).toBeNull();
    expect(knowledgeDocumentTitle('Meu Guia.md')).toBe('Meu Guia');
  });
});

describe('saveKnowledgeDocument', () => {
  it('baixa, salva como documento, indexa e devolve wikilink', async () => {
    const { d, saved, indexed } = deps();
    const download = vi.fn(incoming().download);

    const reply = await saveKnowledgeDocument(incoming({ download }), d);

    expect(download).toHaveBeenCalledOnce();
    expect(saved).toEqual([
      {
        title: 'guia-syncthing',
        sourceFile: 'guia-syncthing.md',
        origem: 'document',
        capturedAt: '2026-07-18T22:03:00.000Z',
        markdown: '# Guia\n\nConteúdo.',
      },
    ]);
    expect(indexed).toEqual(['Sources/2026-07-18-guia-syncthing.md']);
    expect(reply).toBe('Salvei o conteúdo em [[2026-07-18-guia-syncthing]].');
  });

  it('autoriza antes de baixar', async () => {
    const { d, saved } = deps(null);
    const download = vi.fn(incoming().download);

    expect(await saveKnowledgeDocument(incoming({ download }), d)).toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('bloqueia o recurso fora do privado do Luis', async () => {
    const { d } = deps({ chatId: 456, kind: 'private', userName: 'Esposa', subject: 'esposa' });
    const download = vi.fn(incoming().download);

    expect(await saveKnowledgeDocument(incoming({ download }), d)).toContain('privado do Luis');
    expect(download).not.toHaveBeenCalled();
  });

  it('rejeita extensão e tamanho inválidos antes do download', async () => {
    const { d } = deps();
    const download = vi.fn(incoming().download);

    expect(await saveKnowledgeDocument(incoming({ fileName: 'manual.exe', download }), d)).toContain('.pdf');
    expect(download).not.toHaveBeenCalled();

    expect(
      await saveKnowledgeDocument(
        incoming({ fileSize: MAX_KNOWLEDGE_DOCUMENT_BYTES + 1, download }),
        d,
      ),
    ).toContain('maior que 10 MB');
    expect(download).not.toHaveBeenCalled();
  });

  it('salva o texto extraído de um PDF com o nome do arquivo de origem', async () => {
    const { d, saved } = deps();
    d.extractText = vi.fn(async () => 'Conteúdo extraído do manual.');

    const reply = await saveKnowledgeDocument(
      incoming({
        fileName: 'Manual da Empresa.pdf',
        mimeType: 'application/pdf',
        download: async () => new Uint8Array([37, 80, 68, 70, 45]),
      }),
      d,
    );

    expect(d.extractText).toHaveBeenCalledOnce();
    expect(saved[0]).toMatchObject({
      title: 'Manual da Empresa',
      sourceFile: 'Manual da Empresa.pdf',
      origem: 'document',
      markdown: 'Conteúdo extraído do manual.',
    });
    expect(reply).toContain('Salvei o conteúdo');
  });

  it('rejeita arquivo vazio ou binário disfarçado de texto', async () => {
    const { d } = deps();
    expect(
      await saveKnowledgeDocument(incoming({ download: async () => new TextEncoder().encode('  \n') }), d),
    ).toContain('vazio');
    expect(
      await saveKnowledgeDocument(incoming({ download: async () => new Uint8Array([65, 0, 66]) }), d),
    ).toContain('binário');
  });

  it('falha de indexação não perde o documento já salvo', async () => {
    const { d } = deps();
    d.indexFile = async () => {
      throw new Error('índice indisponível');
    };
    expect(await saveKnowledgeDocument(incoming(), d)).toContain('Salvei o conteúdo');
  });
});
