import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import { applyRules, type Category } from '../db/finance.js';
import { categoryPath } from '../lib/category-tree.js';

const classificationSchema = z.object({
  classifications: z.array(z.object({ id: z.string(), category: z.string() })),
});
type Classification = z.infer<typeof classificationSchema>;

export type CategorizeDeps = {
  applyRules: typeof applyRules;
  generate: (opts: { purpose: 'categorize'; system: string; prompt: string; schema: z.Schema<Classification> }) => Promise<Classification>;
};

const defaultDeps: CategorizeDeps = {
  applyRules,
  generate: (opts) => generateAgentObject(opts),
};

/** Sugere uma categoria para cada transação. Primeiro aplica regras aprendidas
 *  (reclassificações anteriores); só o que sobrar vai para o modelo (default/barato).
 *  Casa a resposta da IA pelo ÚLTIMO segmento do caminho, case-insensitive. */
export async function suggestCategoriesFor(
  txs: Array<{ id: string; description: string; amount: number }>,
  categories: Category[],
  deps: CategorizeDeps = defaultDeps,
): Promise<Map<string, Category>> {
  const out = new Map<string, Category>();
  const byId = new Map(categories.map((c) => [c.id, c]));

  const ruleMatches = await deps.applyRules(txs.map((t) => ({ id: t.id, description: t.description })));
  for (const [txId, categoryId] of ruleMatches) {
    const cat = byId.get(categoryId);
    if (cat) out.set(txId, cat);
  }

  const remaining = txs.filter((t) => !out.has(t.id));
  if (remaining.length === 0) return out;

  const paths = categories.map((c) => categoryPath(c.id, categories) ?? c.name);
  const result = await deps.generate({
    purpose: 'categorize',
    system: 'Você classifica transações financeiras brasileiras em categorias de orçamento doméstico.',
    prompt: `Classifique cada transação numa das categorias: ${paths.join(', ')}.\nTransações:\n${remaining
      .map((t) => `${t.id}: ${t.description} (R$ ${t.amount})`)
      .join('\n')}\nResponda com a categoria mais provável para cada id (use exatamente os nomes dados, incluindo o caminho como "Casa > Energia" quando for subcategoria).`,
    schema: classificationSchema,
  });

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  for (const c of result.classifications) {
    const lastSegment = c.category.split('>').pop()?.trim().toLowerCase() ?? '';
    const cat = byName.get(lastSegment);
    if (cat) out.set(c.id, cat);
  }
  return out;
}
