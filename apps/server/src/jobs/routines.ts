import { getState } from '../db/state.js';

export type RoutineKey = 'briefing' | 'coupleBriefing' | 'financeReview' | 'checkin';
export type RoutineSetting = { time: string; enabled: boolean };
export type RoutinesConfig = Record<RoutineKey, RoutineSetting>;

export const DEFAULT_ROUTINES: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true }, // só sábado
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
};

const KEYS: RoutineKey[] = ['briefing', 'coupleBriefing', 'financeReview', 'checkin'];

/** Rotinas a disparar neste minuto (hhmm local; weekday 0=domingo..6=sábado). */
export function dueRoutines(hhmm: string, weekday: number, cfg: RoutinesConfig): RoutineKey[] {
  return KEYS.filter((key) => {
    const r = cfg[key];
    if (!r.enabled || r.time !== hhmm) return false;
    if (key === 'coupleBriefing' && weekday !== 6) return false;
    return true;
  });
}

/** Config das rotinas do app_state (edição via web, Fase 8), mesclada POR ROTINA com os defaults. */
export async function getRoutinesConfig(
  getStateFn: <T>(key: string) => Promise<T | null> = getState,
): Promise<RoutinesConfig> {
  const stored = await getStateFn<Partial<Record<RoutineKey, Partial<RoutineSetting>>>>('routines_config');
  const cfg = {} as RoutinesConfig;
  for (const key of KEYS) cfg[key] = { ...DEFAULT_ROUTINES[key], ...(stored?.[key] ?? {}) };
  return cfg;
}
