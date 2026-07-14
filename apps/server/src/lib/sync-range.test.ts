import { describe, expect, it } from 'vitest';
import { computeSyncRange } from './sync-range.js';

describe('computeSyncRange', () => {
  it('sem estado importa só ontem', () => {
    expect(computeSyncRange(null, '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-07-12' });
  });
  it('dia seguinte ao último importado até ontem (recupera gaps)', () => {
    expect(computeSyncRange('2026-07-08', '2026-07-12')).toEqual({ from: '2026-07-09', to: '2026-07-12' });
  });
  it('respeita o teto de lookback', () => {
    expect(computeSyncRange('2026-01-01', '2026-07-12', 30)).toEqual({ from: '2026-06-12', to: '2026-07-12' });
  });
  it('último importado hoje/futuro não gera from > to', () => {
    expect(computeSyncRange('2026-07-12', '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-07-12' });
  });
});
