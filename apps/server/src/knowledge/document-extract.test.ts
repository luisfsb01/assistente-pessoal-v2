import '../test-setup.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractKnowledgeDocumentText,
  KnowledgeDocumentExtractionError,
  MAX_EXTRACTED_DOCUMENT_CHARS,
} from './document-extract.js';

function pdfWithText(text: string): Uint8Array {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe('extractKnowledgeDocumentText', () => {
  it('extrai texto de um PDF real', async () => {
    const text = await extractKnowledgeDocumentText('manual.pdf', pdfWithText('Manual de processos'));
    expect(text).toContain('Manual de processos');
  });

  it('orienta aplicar OCR quando o PDF não possui camada de texto', async () => {
    await expect(extractKnowledgeDocumentText('escaneado.pdf', pdfWithText(''))).rejects.toMatchObject({
      userMessage: expect.stringContaining('OCR'),
    });
  });

  it('extrai texto de um DOCX real', async () => {
    const fixture = resolve('node_modules/mammoth/test/test-data/single-paragraph.docx');
    const bytes = await readFile(fixture);

    const text = await extractKnowledgeDocumentText('manual.docx', bytes);

    expect(text).toBe('Walking on imported air');
  });

  it('explica quando o arquivo não é um PDF válido', async () => {
    await expect(
      extractKnowledgeDocumentText('manual.pdf', new TextEncoder().encode('não é PDF')),
    ).rejects.toMatchObject<KnowledgeDocumentExtractionError>({
      userMessage: expect.stringContaining('PDF válido'),
    });
  });

  it('rejeita texto vazio, binário e conteúdo excessivamente grande', async () => {
    await expect(
      extractKnowledgeDocumentText('vazio.txt', new TextEncoder().encode('  \n')),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('vazio') });
    await expect(
      extractKnowledgeDocumentText('binario.md', new Uint8Array([65, 0, 66])),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('binário') });
    await expect(
      extractKnowledgeDocumentText(
        'grande.txt',
        new TextEncoder().encode('a'.repeat(MAX_EXTRACTED_DOCUMENT_CHARS + 1)),
      ),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('muito grande') });
  });
});
