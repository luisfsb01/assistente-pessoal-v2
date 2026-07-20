import { describe, expect, it } from 'vitest';
import { computeSyncRange } from './sync-range.js';

describe('computeSyncRange', () => {
  it('sem estado importa só ontem', () => {
    expect(computeSyncRange(null, '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-07-12' });
  });
  it('dia seguinte ao último importado até ontem (recupera gaps)', () => {
    expect(computeSyncRange('2026-07-08', '2026-07-12')).toEqual({ from: '2026-07-09', to: '2026-07-12' });
  });
  it('reconsulta dias recentes para capturar lançamentos tardios do cartão', () => {
    expect(computeSyncRange('2026-07-11', '2026-07-12')).toEqual({ from: '2026-07-09', to: '2026-07-12' });
  });
  it('respeita o teto de lookback', () => {
    expect(computeSyncRange('2026-01-01', '2026-07-12', 30)).toEqual({ from: '2026-06-12', to: '2026-07-12' });
  });
  it('cursor hoje/futuro ainda reconsulta a janela recente sem gerar from > to', () => {
    expect(computeSyncRange('2026-07-13', '2026-07-12')).toEqual({ from: '2026-07-09', to: '2026-07-12' });
  });
});
