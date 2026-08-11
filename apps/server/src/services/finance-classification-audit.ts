import {
  getCategoryByName,
  getTransactionById,
  getTransactionByReviewCode,
  learnRule,
  setTransactionCategory,
  type Category,
  type Transaction,
} from '../db/finance.js';
import {
  normalizeReviewCode,
  parseReviewClassifications,
  type ReviewClassification,
} from './finance-review-reply.js';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type FinanceClassificationAuditDeps = {
  getTransactionByReviewCode: (code: string) => Promise<Transaction | null>;
  getTransactionById: (id: string) => Promise<Transaction | null>;
  getCategoryByName: (name: string) => Promise<Category | null>;
  setTransactionCategory: (transactionId: string, categoryId: string) => Promise<boolean>;
  learnRule: (description: string, categoryId: string) => Promise<void>;
};

const defaultDeps: FinanceClassificationAuditDeps = {
  getTransactionByReviewCode,
  getTransactionById,
  getCategoryByName,
  setTransactionCategory,
  learnRule,
};

const COMPLAINT_PATTERNS = [
  /n[aã]o (?:foi|ficou|est[aá]) (?:re)?classificad/i,
  /n[aã]o classificou/i,
  /continua (?:pendente|errad|na categoria)/i,
  /(?:ontem|antes|j[aá]) (?:eu )?(?:te )?(?:mandei|pedi).*(?:re)?classific/i,
  /voc[eê] disse que (?:corrigiu|classificou|registrou)/i,
  /(?:corrigi|classifiquei|registrei).*(?:mas|por[eé]m).*(?:n[aã]o|continua)/i,
];

export function isFinanceClassificationComplaint(text: string): boolean {
  return COMPLAINT_PATTERNS.some((pattern) => pattern.test(text));
}

function inlineClassification(text: string): ReviewClassification[] | null {
  const match = text.match(/\b([a-z]\d{1,3})\b.*?\b(?:como|para)\s+([^.!?\n]+?)(?:\s+(?:mas|e)\s+n[aã]o\b|[.!?]|$)/i);
  if (!match) return null;
  return [{ code: normalizeReviewCode(match[1]), categoryName: match[2].trim() }];
}

function latestRequestedClassifications(
  complaint: string,
  history: ChatMessage[],
): ReviewClassification[] | null {
  const inline = inlineClassification(complaint);
  if (inline) return inline;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== 'user' || message.content === complaint) continue;
    const parsed = parseReviewClassifications(message.content);
    if (parsed) return parsed;
  }
  return null;
}

function names(items: ReviewClassification[]): string {
  return items.map((item) => `${item.code} como ${item.categoryName}`).join(', ');
}

/**
 * Audita uma reclamacao sobre classificacao anterior, repara divergencias e
 * so confirma sucesso depois de reler categoria e status no banco.
 */
export async function handleFinanceClassificationComplaint(
  text: string,
  history: ChatMessage[],
  deps: FinanceClassificationAuditDeps = defaultDeps,
): Promise<string | null> {
  if (!isFinanceClassificationComplaint(text)) return null;

  const requested = latestRequestedClassifications(text, history);
  if (!requested) {
    return 'Não consegui identificar qual transação você quis conferir. Envie o código e a categoria, por exemplo: A045 - Compras Necessárias.';
  }

  let transactions: Array<Transaction | null>;
  let categories: Array<Category | null>;
  try {
    [transactions, categories] = await Promise.all([
      Promise.all(requested.map((item) => deps.getTransactionByReviewCode(item.code))),
      Promise.all(requested.map((item) => deps.getCategoryByName(item.categoryName))),
    ]);
  } catch (err) {
    console.error('[finance-classification-audit] consulta falhou:', err);
    return 'Não consegui consultar as finanças agora. Não alterei nada; tente novamente em instantes.';
  }

  const missingCodes = requested.filter((_, index) => !transactions[index]).map((item) => item.code);
  if (missingCodes.length > 0) {
    return `Não encontrei a transação ${missingCodes.join(', ')} para conferir. Nada foi alterado.`;
  }

  const missingCategories = requested
    .filter((_, index) => !categories[index])
    .map((item) => item.categoryName);
  if (missingCategories.length > 0) {
    return `Não encontrei a categoria ${[...new Set(missingCategories)].join(', ')}. Nada foi alterado.`;
  }

  const repaired: ReviewClassification[] = [];
  const alreadyCorrect: ReviewClassification[] = [];
  const failed: ReviewClassification[] = [];

  for (let index = 0; index < requested.length; index += 1) {
    const item = requested[index];
    const transaction = transactions[index]!;
    const category = categories[index]!;

    if (transaction.category_id === category.id && transaction.status === 'confirmed') {
      alreadyCorrect.push(item);
      continue;
    }

    try {
      const updated = await deps.setTransactionCategory(transaction.id, category.id);
      const saved = updated ? await deps.getTransactionById(transaction.id) : null;
      if (saved?.category_id === category.id && saved.status === 'confirmed') {
        repaired.push(item);
        await deps.learnRule(transaction.description, category.id).catch((err) => {
          console.error('[finance-classification-audit] nao conseguiu aprender regra:', err);
        });
      } else {
        failed.push(item);
      }
    } catch (err) {
      console.error('[finance-classification-audit] reparo falhou:', err);
      failed.push(item);
    }
  }

  if (failed.length > 0) {
    const verified = [...alreadyCorrect, ...repaired];
    return `${verified.length > 0 ? `Confirmei ${names(verified)}. ` : ''}Não consegui confirmar no banco: ${names(failed)}. Não marquei ${failed.length === 1 ? 'essa alteração' : 'essas alterações'} como concluída${failed.length === 1 ? '' : 's'}.`;
  }
  if (repaired.length === 0) {
    return `Conferi no banco: ${names(alreadyCorrect)} já ${alreadyCorrect.length === 1 ? 'está classificada e confirmada' : 'estão classificadas e confirmadas'}.`;
  }
  return `Você tinha pedido ${names(repaired)}. ${repaired.length === 1 ? 'A alteração não estava salva corretamente; corrigi agora e confirmei' : 'As alterações não estavam salvas corretamente; corrigi agora e confirmei'} no banco.`;
}
