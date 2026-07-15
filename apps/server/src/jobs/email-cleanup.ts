import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import { insertEvent } from '../db/events.js';
import { getState, setState } from '../db/state.js';
import { getConfig } from '../lib/config.js';
import { gmailApiFromGoogle, type InboxEmail } from '../lib/gmail.js';
import { getGmailClient } from '../lib/google.js';
import { recallMemories } from '../memory/recall.js';

const STATE_KEY = 'gmail_cleanup_state';

export type CleanupState = { lastInternalDate: number };

const classifySchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(['lixo', 'importante', 'normal']),
      reason: z.string(),
    }),
  ),
});
type VerdictBatch = z.infer<typeof classifySchema>;
export type EmailVerdict = VerdictBatch['verdicts'][number];

export type EmailCleanupDeps = {
  listNewInboxEmails: (afterEpochMs: number) => Promise<InboxEmail[]>;
  trashMessage: (id: string) => Promise<void>;
  getState: typeof getState;
  setState: typeof setState;
  insertEvent: typeof insertEvent;
  recall: (text: string, subjects: ('luis' | 'esposa' | 'casal')[]) => Promise<Array<{ content: string }>>;
  generate: <T>(opts: { purpose: 'judgment'; system: string; prompt: string; schema: z.Schema<T> }) => Promise<T>;
  now: () => Date;
};

export function defaultCleanupDeps(): EmailCleanupDeps {
  const api = gmailApiFromGoogle(getGmailClient(getConfig()));
  return {
    listNewInboxEmails: api.listNewInboxEmails,
    trashMessage: api.trashMessage,
    getState,
    setState,
    insertEvent,
    recall: recallMemories,
    generate: (opts) => generateAgentObject(opts),
    now: () => new Date(),
  };
}

const SYSTEM = `Você limpa a caixa de entrada de e-mail do Luis. Para cada e-mail decida:
- "lixo": propaganda, promoção, newsletter genérica, notificação de rede social, spam — vai para a lixeira.
- "importante": cobrança, prazo, urgência, assunto pessoal ou financeiro relevante — vai para o resumo matinal.
- "normal": o resto — fica na caixa, sem alarde.
REGRA DE OURO: na dúvida, "normal". Só diga "lixo" quando tiver CERTEZA de que não fará falta.
O motivo (reason) deve ser uma frase curta em PT-BR.`;

/** PURA: e-mails + memórias → prompt de classificação em lote. */
export function buildCleanupPrompt(emails: InboxEmail[], memories: Array<{ content: string }>): string {
  const memoryBlock =
    memories.length > 0 ? `O que você sabe sobre o Luis:\n${memories.map((m) => `- ${m.content}`).join('\n')}\n\n` : '';
  const lines = emails.map((e) => {
    const cat = e.categories.length > 0 ? ` [${e.categories.join(', ')}]` : '';
    return `- id ${e.id}${cat}\n  De: ${e.from}\n  Assunto: ${e.subject}\n  Trecho: ${e.snippet}`;
  });
  return `${memoryBlock}E-mails novos na caixa de entrada:\n${lines.join('\n')}\n\nDevolva um veredito para CADA id listado.`;
}

/** Um ciclo de limpeza: lista novos → classifica em lote → lixeira/briefing/nada.
 *  Estrela nunca vai para a lixeira; falha da IA aborta sem avançar o cursor. */
export async function runEmailCleanup(
  deps: EmailCleanupDeps = defaultCleanupDeps(),
): Promise<{ scanned: number; trashed: number; important: number }> {
  const state = await deps.getState<CleanupState>(STATE_KEY);
  if (!state) {
    // primeira execução: só marca o cursor — não classifica a caixa acumulada
    await deps.setState(STATE_KEY, { lastInternalDate: deps.now().getTime() } satisfies CleanupState);
    return { scanned: 0, trashed: 0, important: 0 };
  }

  const emails = await deps.listNewInboxEmails(state.lastInternalDate);
  if (emails.length === 0) return { scanned: 0, trashed: 0, important: 0 };

  let memories: Array<{ content: string }> = [];
  try {
    memories = await deps.recall(emails.map((e) => `${e.from}: ${e.subject}`).join('\n'), ['luis']);
  } catch (err) {
    console.error('[email-cleanup] recall falhou (seguindo sem memórias):', err);
  }

  let byId: Map<string, EmailVerdict>;
  try {
    const result = await deps.generate({
      purpose: 'judgment',
      system: SYSTEM,
      prompt: buildCleanupPrompt(emails, memories),
      schema: classifySchema,
    });
    byId = new Map(result.verdicts.map((v) => [v.id, v]));
  } catch (err) {
    // IA fora: não avança o cursor — a mesma leva é retentada na próxima rodada
    console.error('[email-cleanup] classificação falhou (rodada abortada):', err);
    return { scanned: emails.length, trashed: 0, important: 0 };
  }

  let trashed = 0;
  let important = 0;
  for (const email of emails) {
    const v = byId.get(email.id);
    // estrela nunca sai da caixa; sem veredito = normal
    const verdict = email.starred ? 'normal' : (v?.verdict ?? 'normal');
    try {
      if (verdict === 'lixo') {
        await deps.trashMessage(email.id); // evento só depois do trash funcionar
        await deps.insertEvent({
          source: 'gmail',
          kind: 'email_trashed',
          dedupeKey: `gmail:trash:${email.id}`,
          summary: `Lixeira: ${email.from} — ${email.subject}`,
          payload: { from: email.from, subject: email.subject },
          resolution: { decision: 'ignore', reason: v?.reason ?? '', target: 'luis', status: 'ignored' },
        });
        trashed++;
      } else if (verdict === 'importante') {
        await deps.insertEvent({
          source: 'gmail',
          kind: 'email_important',
          dedupeKey: `gmail:important:${email.id}`,
          summary: `E-mail importante: ${email.from} — ${email.subject}`,
          payload: { from: email.from, subject: email.subject },
          resolution: { decision: 'briefing', reason: v?.reason ?? '', target: 'luis', status: 'queued' },
        });
        important++;
      }
    } catch (err) {
      console.error(`[email-cleanup] falha no e-mail ${email.id} (a rodada segue):`, err);
    }
  }

  const maxInternal = Math.max(...emails.map((e) => e.internalDate));
  await deps.setState(STATE_KEY, { lastInternalDate: maxInternal } satisfies CleanupState);
  return { scanned: emails.length, trashed, important };
}
