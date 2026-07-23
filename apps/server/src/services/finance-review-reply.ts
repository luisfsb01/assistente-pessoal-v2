import {
  getCategoryByName,
  getTransactionByReviewCode,
  learnRule,
  setTransactionCategory,
  type Category,
  type Transaction,
} from '../db/finance.js';

type ReviewClassification = { code: string; categoryName: string };

export type FinanceReviewReplyDeps = {
  getTransactionByReviewCode: (code: string) => Promise<Transaction | null>;
  getCategoryByName: (name: string) => Promise<Category | null>;
  setTransactionCategory: (transactionId: string, categoryId: string) => Promise<boolean>;
  learnRule: (description: string, categoryId: string) => Promise<void>;
};

const defaultDeps: FinanceReviewReplyDeps = {
  getTransactionByReviewCode,
  getCategoryByName,
  setTransactionCategory,
  learnRule,
};

// O formato aparece literalmente nas mensagens da revisao diaria. Mantemos a
// deteccao estrita para que conversas comuns continuem no fluxo do agente.
const REVIEW_LINE = /^\s*([a-z]\d{3,})\s*(?:-|\u2013|\u2014|=|e|\u00e9)\s*(\S(?:.*\S)?)\s*$/i;
const MAX_CLASSIFICATIONS = 20;

function parseReviewClassifications(text: string): ReviewClassification[] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_CLASSIFICATIONS) return null;

  const classifications: ReviewClassification[] = [];
  const seenCodes = new Set<string>();
  for (const line of lines) {
    const match = line.match(REVIEW_LINE);
    if (!match) return null;
    const code = match[1].toUpperCase();
    if (seenCodes.has(code)) return null;
    seenCodes.add(code);
    classifications.push({ code, categoryName: match[2].trim() });
  }
  return classifications;
}

function listNames(names: string[]): string {
  return names.join(', ');
}

/**
 * Processa respostas estruturadas a revisoes financeiras sem depender do
 * modelo. So retorna texto quando a mensagem inteira e um lote de codigos de
 * revisao; `null` deixa a conversa seguir normalmente para o agente.
 */
export async function handleFinanceReviewReply(
  text: string,
  deps: FinanceReviewReplyDeps = defaultDeps,
): Promise<string | null> {
  const items = parseReviewClassifications(text);
  if (!items) return null;

  // Resolve tudo antes de alterar qualquer registro: um codigo ou categoria
  // invalido nunca deixa o lote parcialmente confirmado.
  const transactions = await Promise.all(items.map((item) => deps.getTransactionByReviewCode(item.code)));
  const unknownCodes = items.filter((_, index) => !transactions[index]).map((item) => item.code);
  if (unknownCodes.length > 0) {
    return `Não encontrei a transação ${listNames(unknownCodes)}. Nada foi alterado.`;
  }

  const categories = await Promise.all(items.map((item) => deps.getCategoryByName(item.categoryName)));
  const unknownCategories = items.filter((_, index) => !categories[index]).map((item) => item.categoryName);
  if (unknownCategories.length > 0) {
    return `Não encontrei a categoria ${listNames([...new Set(unknownCategories)])}. Nada foi alterado.`;
  }

  const persisted: ReviewClassification[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const transaction = transactions[index]!;
    const category = categories[index]!;
    try {
      if (await deps.setTransactionCategory(transaction.id, category.id)) {
        persisted.push(items[index]);
        // O aprendizado nao pode invalidar uma classificacao que ja foi salva.
        await deps.learnRule(transaction.description, category.id).catch((err) => {
          console.error('[finance-review-reply] nao conseguiu aprender regra:', err);
        });
      }
    } catch (err) {
      console.error('[finance-review-reply] nao conseguiu salvar classificacao:', err);
    }
  }

  if (persisted.length === items.length) {
    return `Pronto — registrei ${listNames(persisted.map((item) => item.code))}.`;
  }
  if (persisted.length > 0) {
    return `Registrei ${listNames(persisted.map((item) => item.code))}, mas não consegui salvar as demais. Tente novamente.`;
  }
  return 'Não consegui salvar essas classificações agora. Tente novamente.';
}
