import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import type { QueueEvent } from '../db/events.js';
import { recallMemories } from '../memory/recall.js';

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      decision: z.enum(['notify', 'briefing', 'ignore']),
      target: z.enum(['luis', 'esposa', 'grupo']),
      reason: z.string(),
    }),
  ),
});
type DecisionBatch = z.infer<typeof decisionSchema>;

export type JudgedDecision = DecisionBatch['decisions'][number];

export type JudgeDeps = {
  generate: <T>(opts: { purpose: 'judgment'; system: string; prompt: string; schema: z.Schema<T> }) => Promise<T>;
  recall: (text: string, subjects: ('luis' | 'esposa' | 'casal')[]) => Promise<Array<{ content: string }>>;
};

const defaultDeps: JudgeDeps = {
  generate: (opts) => generateAgentObject(opts),
  recall: recallMemories,
};

const SYSTEM = `Você é o filtro de proatividade de um assistente pessoal de um casal (Luis e esposa).
Para cada evento, decida:
- "notify": interromper AGORA — só para o que é urgente E acionável hoje (gasto muito fora do padrão, conflito de agenda iminente, compromisso de amanhã cedo avisado na véspera).
- "briefing": informativo — vale mencionar no resumo matinal, não vale interrupção.
- "ignore": trivial, repetido ou irrelevante.
Na dúvida, escolha "briefing". Escolha o destino: "luis", "esposa" (dono do assunto) ou "grupo" (assuntos do casal).
O motivo (reason) deve ser uma frase curta em PT-BR.`;

/** Julga eventos pendentes em UM lote com o modelo barato + memórias relevantes.
 *  Garante uma decisão para cada evento: ids não devolvidos pela IA (ou erro na IA)
 *  degradam para briefing — nunca se perde evento nem se notifica sem julgamento. */
export async function judgeEvents(
  events: QueueEvent[],
  nowLocal: string,
  deps: JudgeDeps = defaultDeps,
): Promise<JudgedDecision[]> {
  if (events.length === 0) return [];

  let memories: Array<{ content: string }> = [];
  try {
    memories = await deps.recall(events.map((e) => e.summary).join('\n'), ['luis', 'esposa', 'casal']);
  } catch (err) {
    console.error('[judge] recall falhou (seguindo sem memórias):', err);
  }

  const memoryBlock =
    memories.length > 0 ? `\nO que você sabe sobre eles:\n${memories.map((m) => `- ${m.content}`).join('\n')}\n` : '';

  const prompt = `Agora são ${nowLocal} (hora local).
${memoryBlock}
Eventos para julgar:
${events.map((e) => `- id ${e.id} [${e.source}/${e.kind}]: ${e.summary}`).join('\n')}

Devolva uma decisão para CADA id listado.`;

  let byId = new Map<string, JudgedDecision>();
  try {
    const result = await deps.generate({ purpose: 'judgment', system: SYSTEM, prompt, schema: decisionSchema });
    byId = new Map(result.decisions.map((d) => [d.id, d]));
  } catch (err) {
    console.error('[judge] julgamento falhou (degradando tudo para briefing):', err);
  }

  return events.map(
    (e) =>
      byId.get(e.id) ?? {
        id: e.id,
        decision: 'briefing' as const,
        target: 'luis' as const,
        reason: 'sem decisão da IA — guardado para o briefing',
      },
  );
}
