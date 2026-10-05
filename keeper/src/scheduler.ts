// Runs each loop on its interval, serialised per loop (a slow tick never overlaps the next), tracks the last successful
// tick and consecutive failures for /healthz and keeper_health, and alerts after 3 consecutive failures.
import type { Alerter } from "./alerts";
import type { Logger } from "./log";

export interface LoopDef { name: string; intervalMs: number; run: () => Promise<unknown> }
export interface LoopState { name: string; lastOkAt: Date | null; lastRunAt: Date | null; consecutiveFailures: number; lastError: string | null; runs: number }
export interface SchedulerOptions { log: Logger; alerter: Alerter; alertAfter?: number; onState?: (s: LoopState) => Promise<void> | void; now?: () => Date; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }

export class Scheduler {
  readonly state = new Map<string, LoopState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private readonly alertAfter: number;
  constructor(private readonly loops: LoopDef[], private readonly opts: SchedulerOptions) {
    this.alertAfter = opts.alertAfter ?? 3;
    for (const l of loops) this.state.set(l.name, { name: l.name, lastOkAt: null, lastRunAt: null, consecutiveFailures: 0, lastError: null, runs: 0 });
  }

  start(): void {
    for (const l of this.loops) void this.cycle(l);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) (this.opts.clearTimer ?? clearTimeout)(t);
  }

  /** One tick of one loop. Exposed for tests and for the CI reconciler (`--once`). */
  async tick(name: string): Promise<LoopState> {
    const loop = this.loops.find((l) => l.name === name);
    if (!loop) throw new Error(`no loop ${name}`);
    const s = this.state.get(name)!;
    const now = this.opts.now ?? (() => new Date());
    s.lastRunAt = now();
    s.runs++;
    try {
      const result = await loop.run();
      s.lastOkAt = now();
      s.consecutiveFailures = 0;
      s.lastError = null;
      this.opts.log.info("tick ok", { loop: name, result });
    } catch (e) {
      s.consecutiveFailures++;
      s.lastError = ((e as Error).message || (e as Error).name || String(e));
      this.opts.log.error("tick failed", { loop: name, consecutiveFailures: s.consecutiveFailures, error: s.lastError });
      if (s.consecutiveFailures === this.alertAfter) {
        await this.opts.alerter.alert(`keeper loop ${name} failing`, `${this.alertAfter} consecutive failures. Last: ${s.lastError}`).catch((ae) => this.opts.log.error("alert failed", { error: (ae as Error).message }));
      }
    }
    await this.opts.onState?.(s);
    return s;
  }

  private async cycle(loop: LoopDef): Promise<void> {
    if (this.stopped) return;
    await this.tick(loop.name);
    if (this.stopped) return;
    this.timers.set(loop.name, (this.opts.setTimer ?? setTimeout)(() => void this.cycle(loop), loop.intervalMs));
  }
}
