import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('bloqueia acima do teto e libera na janela seguinte', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(2, 1_000, () => now);
    expect(limiter.allow('u')).toBe(true);
    expect(limiter.allow('u')).toBe(true);
    expect(limiter.allow('u')).toBe(false);
    now = 1_000;
    expect(limiter.allow('u')).toBe(true);
  });

  it('isola chaves diferentes', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, () => 0);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
  });
});
