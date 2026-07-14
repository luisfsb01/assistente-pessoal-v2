import { getState } from '../db/state.js';

export type ProactivityConfig = {
  quietStart: string; // 'HH:MM' — início do silêncio
  quietEnd: string; // 'HH:MM' — fim do silêncio
  maxNotificationsPerDay: number; // teto por destino (luis/esposa/grupo)
};

export const DEFAULT_PROACTIVITY: ProactivityConfig = {
  quietStart: '22:00',
  quietEnd: '07:00',
  maxNotificationsPerDay: 5,
};

/** Hora local 'HH:MM' de um instante num fuso. */
export function localTimeHHMM(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** true se hhmm cai na janela de silêncio [quietStart, quietEnd) — que pode cruzar a meia-noite. */
export function isQuietHours(hhmm: string, cfg: ProactivityConfig): boolean {
  const { quietStart: s, quietEnd: e } = cfg;
  if (s <= e) return hhmm >= s && hhmm < e;
  return hhmm >= s || hhmm < e; // cruza a meia-noite (ex.: 22:00–07:00)
}

/** Config de proatividade do app_state, mesclada com os defaults (edição via web fica p/ Fase 8). */
export async function getProactivityConfig(): Promise<ProactivityConfig> {
  const stored = await getState<Partial<ProactivityConfig>>('proactivity_config');
  return { ...DEFAULT_PROACTIVITY, ...(stored ?? {}) };
}
