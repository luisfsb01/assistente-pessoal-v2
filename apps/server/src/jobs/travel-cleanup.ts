import { InlineKeyboard } from 'grammy';
import { encodeTravelCleanupAction } from '../bot/callback.js';
import { getGroupChatId } from '../db/chats.js';
import { listPastUnpromptedTravelLists, markTravelCleanupPrompted } from '../db/lists.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import type { SendWithKb } from './daily-checkin.js';

export type TravelCleanupDeps = {
  getGroupChatId: typeof getGroupChatId;
  listPastUnpromptedTravelLists: typeof listPastUnpromptedTravelLists;
  markTravelCleanupPrompted: typeof markTravelCleanupPrompted;
  todayIso: () => string;
};

const defaultDeps: TravelCleanupDeps = {
  getGroupChatId,
  listPastUnpromptedTravelLists,
  markTravelCleanupPrompted,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

function ddmm(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

/** Pergunta uma única vez, no grupo, se a lista de uma viagem passada pode ser apagada. */
export async function runTravelCleanup(
  send: SendWithKb,
  deps: TravelCleanupDeps = defaultDeps,
): Promise<number> {
  const chatId = await deps.getGroupChatId();
  if (chatId === null) return 0;

  let sent = 0;
  const lists = await deps.listPastUnpromptedTravelLists(deps.todayIso());
  for (const list of lists) {
    const kb = new InlineKeyboard()
      .text('🗑️ Pode apagar', encodeTravelCleanupAction('delete', list.id))
      .text('📌 Manter', encodeTravelCleanupAction('keep', list.id));
    await send(
      chatId,
      `A viagem “${list.name}” (${ddmm(list.travelDate)}) já passou. Posso apagar a lista dessa viagem?`,
      kb,
    );
    await deps.markTravelCleanupPrompted(list.id);
    sent++;
  }
  return sent;
}
