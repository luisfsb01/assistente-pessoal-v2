import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROACTIVITY, isQuietHours, localTimeHHMM } from './rules.js';

describe('localTimeHHMM', () => {
  it('converte para HH:MM no fuso pedido', () => {
    // 01:30Z = 22:30 do dia anterior em São Paulo (UTC-3)
    expect(localTimeHHMM(new Date('2026-07-15T01:30:00Z'), 'America/Sao_Paulo')).toBe('22:30');
    expect(localTimeHHMM(new Date('2026-07-15T12:05:00Z'), 'America/Sao_Paulo')).toBe('09:05');
  });
});

describe('isQuietHours (22:00–07:00, cruza a meia-noite)', () => {
  it.each([
    ['22:00', true],
    ['23:59', true],
    ['00:30', true],
    ['06:59', true],
    ['07:00', false],
    ['12:00', false],
    ['21:59', false],
  ])('%s → %s', (hhmm, expected) => {
    expect(isQuietHours(hhmm, DEFAULT_PROACTIVITY)).toBe(expected);
  });

  it('janela que não cruza a meia-noite (13:00–15:00)', () => {
    const cfg = { ...DEFAULT_PROACTIVITY, quietStart: '13:00', quietEnd: '15:00' };
    expect(isQuietHours('14:00', cfg)).toBe(true);
    expect(isQuietHours('16:00', cfg)).toBe(false);
    expect(isQuietHours('12:59', cfg)).toBe(false);
  });
});
