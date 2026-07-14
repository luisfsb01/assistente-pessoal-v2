import { describe, expect, it } from 'vitest';
import { addDays, todayInTz } from './dates.js';

describe('todayInTz', () => {
  it('retorna YYYY-MM-DD no fuso pedido', () => {
    // 2026-07-13T01:00Z ainda é 2026-07-12 em São Paulo (UTC-3)
    expect(todayInTz('America/Sao_Paulo', new Date('2026-07-13T01:00:00Z'))).toBe('2026-07-12');
    expect(todayInTz('America/Sao_Paulo', new Date('2026-07-13T12:00:00Z'))).toBe('2026-07-13');
  });
});

describe('addDays', () => {
  it('soma e subtrai dias atravessando mês', () => {
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-07-13', 0)).toBe('2026-07-13');
  });
});
