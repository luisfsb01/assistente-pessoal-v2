import { InlineKeyboard } from 'grammy';
import { encodeHabitAction, encodePtaskAction } from '../bot/callback.js';
import { getSubjectChatId, getUserBySubject } from '../db/chats.js';
import { getCheckin, pendingHabitsFor, upsertCheckin } from '../db/habits.js';
import { listOverdueProjectTasks } from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

const MAX_PTASKS = 5;

export type SendWithKb = (chatId: number, text: string, kb?: InlineKeyboard) => Promise<void>;

export type CheckinDeps = {
  getUserBySubject: typeof getUserBySubject;
  getSubjectChatId: typeof getSubjectChatId;
  pendingHabitsFor: typeof pendingHabitsFor;
  getCheckin: typeof getCheckin;
  upsertCheckin: typeof upsertCheckin;
  listOverdueProjectTasks: typeof listOverdueProjectTasks;
  todayIso: () => string;
};

const defaultDeps: CheckinDeps = {
  getUserBySubject,
  getSubjectChatId,
  pendingHabitsFor,
  getCheckin,
  upsertCheckin,
  listOverdueProjectTasks,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** Registra a resposta do botão com idempotência:
 *  'novo' = primeiro registro do dia (avança a fila); 'repetido' = reclique igual (não grava);
 *  'alterado' = mudou de ideia (grava, não avança — a fila já andou na primeira vez). */
export async function registerHabitAnswer(
  habitId: string,
  done: boolean,
  date: string,
  deps: CheckinDeps = defaultDeps,
): Promise<'novo' | 'repetido' | 'alterado'> {
  const existing = await deps.getCheckin(habitId, date);
  if (existing && existing.done === done) return 'repetido';
  await deps.upsertCheckin(habitId, date, done);
  return existing ? 'alterado' : 'novo';
}

/** Próxima pergunta do check-in: primeiro hábito pendente do dia; sem hábito
 *  pendente, o lote de tarefas de projeto vencidas (cap 5). Nada pendente = silêncio. */
export async function sendNextCheckinQuestion(
  userId: string,
  chatId: number,
  send: SendWithKb,
  deps: CheckinDeps = defaultDeps,
  interactionMode: 'buttons' | 'hermes' = 'buttons',
): Promise<void> {
  const today = deps.todayIso();
  const pending = await deps.pendingHabitsFor(userId, today);
  if (pending.length > 0) {
    const h = pending[0];
    if (interactionMode === 'hermes') {
      await send(
        chatId,
        `${h.name} hoje?\nResponda ao Hermes: "Registre o hábito ${h.name} como feito hoje" ou "como não feito hoje".`,
      );
    } else {
      const kb = new InlineKeyboard().text('✅', encodeHabitAction(true, h.id)).text('❌', encodeHabitAction(false, h.id));
      await send(chatId, `${h.name} hoje?`, kb);
    }
    return;
  }
  const overdue = (await deps.listOverdueProjectTasks(userId, today)).slice(0, MAX_PTASKS);
  for (const t of overdue) {
    const text = `Tarefa vencida no projeto ${t.projectName}: "${t.title}" (prazo ${ddmm(t.dueDate!)})`;
    if (interactionMode === 'hermes') {
      await send(
        chatId,
        `${text}\nResponda ao Hermes: "Marque a tarefa de projeto ${t.id} como concluída" ou "mantenha pendente".`,
      );
    } else {
      const kb = new InlineKeyboard()
        .text('✅ Concluí', encodePtaskAction('done', t.id))
        .text('❌ Segue pendente', encodePtaskAction('keep', t.id));
      await send(chatId, text, kb);
    }
  }
}

/** Check-in das 21:00 — rotina direta (sem juiz, fora do teto da F4), por pessoa no privado. */
export async function runDailyCheckin(
  send: SendWithKb,
  deps: CheckinDeps = defaultDeps,
  interactionMode: 'buttons' | 'hermes' = 'buttons',
): Promise<void> {
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      const chatId = await deps.getSubjectChatId(subject);
      if (chatId === null) continue;
      await sendNextCheckinQuestion(user.id, chatId, send, deps, interactionMode);
    } catch (err) {
      console.error(`[checkin] falhou para ${subject}:`, err);
    }
  }
}
