import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTINES, dueRoutines, getRoutinesConfig, type RoutinesConfig } from './routines.js';

const cfg: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true },
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
};

describe('dueRoutines', () => {
  it('dispara a rotina cujo horário bate', () => {
    expect(dueRoutines('07:00', 3, cfg)).toEqual(['briefing']);
    expect(dueRoutines('21:00', 3, cfg)).toEqual(['checkin']);
  });

  it('horário sem rotina não dispara nada', () => {
    expect(dueRoutines('07:01', 3, cfg)).toEqual([]);
  });

  it('enabled=false não dispara', () => {
    const off = { ...cfg, checkin: { time: '21:00', enabled: false } };
    expect(dueRoutines('21:00', 3, off)).toEqual([]);
  });

  it('briefing do casal só dispara no sábado', () => {
    expect(dueRoutines('08:00', 6, cfg)).toEqual(['coupleBriefing', 'financeReview']);
    expect(dueRoutines('08:00', 0, cfg)).toEqual(['financeReview']);
    expect(dueRoutines('08:00', 2, cfg)).toEqual(['financeReview']);
  });

  it('duas rotinas no mesmo horário disparam juntas', () => {
    const same = { ...cfg, briefing: { time: '08:00', enabled: true } };
    expect(dueRoutines('08:00', 6, same)).toEqual(['briefing', 'coupleBriefing', 'financeReview']);
  });
});

describe('getRoutinesConfig', () => {
  it('sem estado salvo retorna os defaults', async () => {
    const result = await getRoutinesConfig(async () => null);
    expect(result).toEqual(DEFAULT_ROUTINES);
  });

  it('mescla parciais por rotina com os defaults', async () => {
    const result = await getRoutinesConfig(async <T,>() =>
      ({ checkin: { time: '20:30' }, briefing: { enabled: false } }) as T,
    );
    expect(result.checkin).toEqual({ time: '20:30', enabled: true });
    expect(result.briefing).toEqual({ time: '07:00', enabled: false });
    expect(result.financeReview).toEqual({ time: '08:00', enabled: true });
  });
});
