// Token-bucket limiter for RPC calls (human note on M4 task 5: the indexer must not skew the soak) with request-rate
// counters so the per-minute rate can be logged next to the keeper's settle timing.
export interface RateStats { total: number; lastMinute: number; waitedMs: number }

export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private stamps: number[] = [];
  private waited = 0;
  private total = 0;
  constructor(private readonly perSecond: number, private readonly burst = Math.max(1, Math.ceil(perSecond)), private readonly now: () => number = Date.now, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.tokens = this.burst;
    this.last = now();
  }
  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
  }
  /** Waits until a token is available, then consumes it. */
  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        this.total++;
        const t = this.now();
        this.stamps.push(t);
        if (this.stamps.length > 10_000) this.stamps = this.stamps.filter((s) => t - s < 60_000);
        return;
      }
      const ms = Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
      this.waited += ms;
      await this.sleep(ms);
    }
  }
  stats(): RateStats {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    return { total: this.total, lastMinute: this.stamps.length, waitedMs: this.waited };
  }
}
