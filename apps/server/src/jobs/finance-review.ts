import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { encodeFinAction } from '../bot/callback.js';
import { getSubjectChatId } from '../db/chats.js';
import {
  ensureReviewCode,
  getLastImportedDate,
  listCategories,
  listTransactionsBetween,
  setLastImportedDate,
  suggestTransactionCategory,
  type Category,
} from '../db/finance.js';
import { checkBankHealth, isBankConfigured } from '../lib/banco-mcp.js';
import { formatBankHealthAlert } from '../lib/banco-health.js';
import { categoryPath } from '../lib/category-tree.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';
import { computeSyncRange } from '../lib/sync-range.js';
import { syncBankTransactions } from '../services/bank-sync.js';
import { suggestCategoriesFor } from '../services/categorize.js';

const MAX_REVIEW = 15;

/** Linha da mensagem de revisão de UMA transação (pura, para teste). */
export function formatReviewLine(
  tx: { occurred_on: string; description: string; amount: number },
  code: string | null,
  catName: string,
): string {
  const [, m, d] = tx.occurred_on.split('-');
  return `${code ? `[${code}] ` : ''}${d}/${m}: ${tx.description} — ${formatBrl(Number(tx.amount))}\n🏷 ${catName}\n(✅ confirma; para trocar, responda: "${code ?? 'A001'} é <categoria>")`;
}

/** Revisão diária: importa do banco, sugere categorias e envia os pendentes
 *  ao privado do Luis, um por mensagem, com botão ✅. */
export async function runFinanceReview(bot: Bot): Promise<void> {
  const config = getConfig();
  const chatId = await getSubjectChatId('luis');
  if (chatId === null) return;

  const yesterday = addDays(todayInTz(config.TIMEZONE), -1);

  // 1) importa do banco (se configurado)
  let importedCount = 0; // total do intervalo (após um gap, cobre vários dias)
  let syncOk = false;
  if (isBankConfigured()) {
    try {
      const { from, to } = computeSyncRange(await getLastImportedDate(), yesterday);
      const synced = await syncBankTransactions(from, to);
      importedCount = synced.imported;
      await setLastImportedDate(yesterday);
      syncOk = true;
    } catch (err) {
      console.error('[job:finance-review] importação do Banco MCP falhou:', err);
      const reason = err instanceof Error ? err.message : '';
      await bot.api.sendMessage(
        chatId,
        `⚠️ Não consegui importar os gastos do banco${reason ? `:\n${reason}` : '.'}\nVou revisar só o que está pendente.`,
      );
    }
  }

  // 1b) Importou OK mas veio zero: pode ser dia sem gasto OU banco com problema.
  // Checa a saúde e avisa só se houver incidente — o silêncio nunca fica ambíguo.
  if (syncOk && importedCount === 0) {
    try {
      const health = await checkBankHealth();
      if (health.problems.length > 0) {
        await bot.api.sendMessage(chatId, formatBankHealthAlert(health));
      }
    } catch (err) {
      console.error('[job:finance-review] checagem de saúde do banco falhou:', err);
    }
  }

  // 2) pendentes de revisão (últimos 30 dias até hoje)
  const pending = (await listTransactionsBetween(addDays(yesterday, -30), todayInTz(config.TIMEZONE))).filter(
    (t) => t.status === 'pending_review',
  );
  if (pending.length === 0) return; // nada a revisar; silêncio

  const toReview = pending.slice(0, MAX_REVIEW);
  const extra = pending.length - toReview.length;

  // 3) sugere categorias com o modelo — falha aqui não pode matar a revisão
  const categories = await listCategories();
  let suggestions = new Map<string, Category>();
  try {
    suggestions = await suggestCategoriesFor(
      toReview.map((t) => ({ id: t.id, description: t.description, amount: Number(t.amount) })),
      categories,
    );
  } catch (err) {
    console.error('[job:finance-review] sugestão de categorias falhou:', err);
  }

  // 4) uma mensagem por transação, com botão ✅
  await bot.api.sendMessage(
    chatId,
    `💸 Gastos para revisar (${pending.length})${extra > 0 ? `, mostrando os ${toReview.length} mais antigos:` : ':'}`,
  );
  for (const t of toReview) {
    const suggested = suggestions.get(t.id);
    // só exibe a sugestão se ela foi gravada (senão o ✅ confirmaria algo diferente do mostrado)
    let applied = false;
    if (suggested) applied = await suggestTransactionCategory(t.id, suggested.id).catch(() => false);
    const catName =
      applied && suggested
        ? (categoryPath(suggested.id, categories) ?? suggested.name)
        : t.category_id
          ? (categoryPath(t.category_id, categories) ?? t.category_name ?? 'Sem categoria')
          : 'Sem categoria';
    const code = await ensureReviewCode(t.id).catch(() => null);
    const kb = new InlineKeyboard().text('✅ Confirmar', encodeFinAction('ok', t.id));
    await bot.api.sendMessage(chatId, formatReviewLine(t, code, catName), { reply_markup: kb });
  }

  if (extra > 0) {
    await bot.api.sendMessage(chatId, `+${extra} gastos pendentes. Veja todos na página Transações do site.`);
  }
}
