import type { ChatIdentity } from '../db/chats.js';
import { getChatIdentity } from '../db/chats.js';
import { canAccess } from '../agent/capabilities.js';
import {
  extractKnowledgeDocumentText,
  KnowledgeDocumentExtractionError,
} from './document-extract.js';
import { indexFile } from './indexer.js';
import { writeSourceNote, type SourceNote } from './vault.js';

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type IncomingKnowledgeDocument = {
  chatId: number;
  senderId?: number;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  download: () => Promise<Uint8Array>;
};

export type KnowledgeDocumentDeps = {
  getChatIdentity: (chatId: number, senderId?: number) => Promise<ChatIdentity | null>;
  writeSourceNote: (note: SourceNote) => Promise<string>;
  indexFile: (relPath: string) => Promise<'indexed' | 'unchanged'>;
  extractText: (fileName: string, bytes: Uint8Array) => Promise<string>;
  nowIso: () => string;
};

const defaultDeps: KnowledgeDocumentDeps = {
  getChatIdentity,
  writeSourceNote: (note) => writeSourceNote(note),
  indexFile: (relPath) => indexFile(relPath),
  extractText: extractKnowledgeDocumentText,
  nowIso: () => new Date().toISOString(),
};

function leafFileName(raw: string): string {
  return raw.split(/[\\/]/).at(-1)?.trim() ?? '';
}

export function supportedKnowledgeDocumentName(raw: string | undefined): string | null {
  if (!raw) return null;
  const name = leafFileName(raw);
  return /\.(md|markdown|txt|pdf|docx)$/i.test(name) ? name : null;
}

export function knowledgeDocumentTitle(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt|pdf|docx)$/i, '').trim() || 'Documento sem título';
}

function noteNameFromPath(relPath: string): string {
  return relPath.replace(/^.*\//, '').replace(/\.md$/, '');
}

/** Salva anexos textuais do Telegram sem passar o conteúdo pelo modelo de chat. */
export async function saveKnowledgeDocument(
  msg: IncomingKnowledgeDocument,
  deps: KnowledgeDocumentDeps = defaultDeps,
): Promise<string | null> {
  const identity = await deps.getChatIdentity(msg.chatId, msg.senderId);
  if (!identity) return null;
  if (!canAccess(identity, 'knowledge')) {
    return 'O segundo cérebro só está disponível no privado do Luis.';
  }

  const fileName = supportedKnowledgeDocumentName(msg.fileName);
  if (!fileName) return 'Consigo salvar arquivos .md, .markdown, .txt, .pdf e .docx.';
  if (msg.fileSize !== undefined && msg.fileSize > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    return 'O arquivo é maior que 10 MB. Envie uma versão menor.';
  }

  const bytes = await msg.download();
  if (bytes.byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    return 'O arquivo é maior que 10 MB. Envie uma versão menor.';
  }

  let markdown: string;
  try {
    markdown = await deps.extractText(fileName, bytes);
  } catch (err) {
    if (err instanceof KnowledgeDocumentExtractionError) return err.userMessage;
    console.error('[knowledge] extração de documento falhou:', err);
    return 'Não consegui extrair o texto desse documento.';
  }

  const relPath = await deps.writeSourceNote({
    title: knowledgeDocumentTitle(fileName),
    sourceFile: fileName,
    origem: 'document',
    capturedAt: deps.nowIso(),
    markdown,
  });
  try {
    await deps.indexFile(relPath);
  } catch (err) {
    // A nota no vault é a fonte da verdade; o índice pode ser reconstruído depois.
    console.error('[knowledge] indexação de documento falhou (nota salva mesmo assim):', err);
  }
  return `Salvei o conteúdo em [[${noteNameFromPath(relPath)}]].`;
}
