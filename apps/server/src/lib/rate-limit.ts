export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const timestamp = this.now();
    const current = this.hits.get(key);
    if (!current || timestamp >= current.resetAt) {
      this.hits.set(key, { count: 1, resetAt: timestamp + this.windowMs });
      if (this.hits.size > 1_000) this.prune(timestamp);
      return true;
    }
    if (current.count >= this.max) return false;
    current.count += 1;
    return true;
  }

  private prune(timestamp: number): void {
    for (const [key, value] of this.hits) if (timestamp >= value.resetAt) this.hits.delete(key);
  }
}
