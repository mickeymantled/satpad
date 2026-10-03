import { describe, expect, it } from "vitest";
import { TelegramAlerter, type Alerter } from "../src/alerts";
import { healthReport } from "../src/health";
import { createLogger } from "../src/log";
import { Scheduler, type LoopDef } from "../src/scheduler";

const log = createLogger({}, "error", () => {});

describe("Scheduler", () => {
  it("tracks ok ticks, consecutive failures, alerts exactly once at 3, resets on success", async () => {
    const alerts: string[] = [];
    const alerter: Alerter = { alert: async (t) => { alerts.push(t); } };
    let fail = false;
    const states: number[] = [];
    const loops: LoopDef[] = [{ name: "settle", intervalMs: 60_000, run: async () => { if (fail) throw new Error("boom"); return { ok: 1 }; } }];
    const s = new Scheduler(loops, { log, alerter, onState: (st) => { states.push(st.consecutiveFailures); } });
    expect((await s.tick("settle")).lastOkAt).not.toBeNull();
    fail = true;
    for (let i = 0; i < 5; i++) await s.tick("settle");
    expect(alerts).toEqual(["keeper loop settle failing"]); // once, at the 3rd
    expect(s.state.get("settle")!.consecutiveFailures).toBe(5);
    fail = false;
    await s.tick("settle");
    expect(s.state.get("settle")!.consecutiveFailures).toBe(0);
    expect(states).toEqual([0, 1, 2, 3, 4, 5, 0]);
  });

  it("start() runs immediately and reschedules on the interval; stop() cancels", async () => {
    let runs = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const loops: LoopDef[] = [{ name: "a", intervalMs: 123, run: async () => { runs++; } }];
    const s = new Scheduler(loops, { log, alerter: { alert: async () => {} }, setTimer: ((fn: () => void, ms: number) => { timers.push({ fn, ms }); return 0 as never; }) as never, clearTimer: (() => {}) as never });
    s.start();
    await new Promise((r) => setImmediate(r));
    expect(runs).toBe(1);
    expect(timers[0]!.ms).toBe(123);
    timers[0]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(runs).toBe(2);
    s.stop();
    timers[1]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(runs).toBe(2);
  });
});

describe("healthReport", () => {
  it("is unhealthy when a loop is stale (> 3 intervals) or failing 3+ times", async () => {
    const loops: LoopDef[] = [{ name: "settle", intervalMs: 1_000, run: async () => {} }];
    const s = new Scheduler(loops, { log, alerter: { alert: async () => {} } });
    expect(healthReport(s, loops).ok).toBe(false); // never ran
    await s.tick("settle");
    expect(healthReport(s, loops).ok).toBe(true);
    expect(healthReport(s, loops, new Date(Date.now() + 3_001)).ok).toBe(false);
  });
});

describe("TelegramAlerter", () => {
  it("posts to the bot API and throws on non-2xx", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (url: string, init: { body: string }) => { calls.push({ url, body: init.body }); return { ok: true, status: 200 }; }) as unknown as typeof fetch;
    await new TelegramAlerter("TOKEN", "42", fetchFn).alert("t", "b");
    expect(calls[0]!.url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ chat_id: "42" });
    const bad = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(new TelegramAlerter("T", "1", bad).alert("t", "b")).rejects.toThrow(/429/);
  });
});
