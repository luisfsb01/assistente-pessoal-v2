import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const MAX_EXTRACTED_DOCUMENT_CHARS = 200_000;

export class KnowledgeDocumentExtractionError extends Error {
  constructor(public readonly userMessage: string, options?: ErrorOptions) {
    super(userMessage, options);
    this.name = 'KnowledgeDocumentExtractionError';
  }
}

function extension(fileName: string): string {
  return fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
}

function validateExtractedText(fileName: string, raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) {
    if (extension(fileName) === '.pdf') {
      throw new KnowledgeDocumentExtractionError(
        'Não encontrei texto no PDF. Se ele for escaneado como imagem, será necessário aplicar OCR antes.',
      );
    }
    throw new KnowledgeDocumentExtractionError('O arquivo está vazio ou não contém texto.');
  }
  if (text.length > MAX_EXTRACTED_DOCUMENT_CHARS) {
    throw new KnowledgeDocumentExtractionError(
      'O texto extraído é muito grande. Divida o documento em arquivos menores.',
    );
  }
  return text;
}

function extractPlainText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (text.includes('\0')) {
      throw new KnowledgeDocumentExtractionError('O arquivo parece ser binário, não texto.');
    }
    return text;
  } catch (err) {
    if (err instanceof KnowledgeDocumentExtractionError) throw err;
    throw new KnowledgeDocumentExtractionError('Não consegui ler o arquivo como texto UTF-8.', {
      cause: err,
    });
  }
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new KnowledgeDocumentExtractionError('O arquivo não parece ser um PDF válido.');
  }
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText({ pageJoiner: '' });
    return result.pages.map((page) => page.text).join('\n\n');
  } catch (err) {
    throw new KnowledgeDocumentExtractionError(
      'Não consegui ler o PDF. Ele pode estar protegido por senha ou corrompido.',
      { cause: err },
    );
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new KnowledgeDocumentExtractionError('O arquivo não parece ser um DOCX válido.');
  }
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  } catch (err) {
    throw new KnowledgeDocumentExtractionError(
      'Não consegui ler o DOCX. Ele pode estar protegido ou corrompido.',
      { cause: err },
    );
  }
}

/** Extrai somente texto; imagens e layout visual não entram no segundo cérebro. */
export async function extractKnowledgeDocumentText(
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const ext = extension(fileName);
  let raw: string;
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') raw = extractPlainText(bytes);
  else if (ext === '.pdf') raw = await extractPdf(bytes);
  else if (ext === '.docx') raw = await extractDocx(bytes);
  else throw new KnowledgeDocumentExtractionError('Formato de documento não suportado.');
  return validateExtractedText(fileName, raw);
}
