// /healthz: last successful tick per loop (SPEC). Unhealthy (503) when any loop has not succeeded within 3 intervals.
import { createServer, type Server } from "node:http";
import type { LoopDef, Scheduler } from "./scheduler";

export function healthReport(sched: Scheduler, loops: LoopDef[], now = new Date()): { ok: boolean; loops: Record<string, unknown> } {
  let ok = true;
  const out: Record<string, unknown> = {};
  for (const l of loops) {
    const s = sched.state.get(l.name)!;
    const staleMs = s.lastOkAt ? now.getTime() - s.lastOkAt.getTime() : Infinity;
    const healthy = staleMs <= l.intervalMs * 3 && s.consecutiveFailures < 3;
    ok &&= healthy;
    out[l.name] = { healthy, lastOkAt: s.lastOkAt?.toISOString() ?? null, lastRunAt: s.lastRunAt?.toISOString() ?? null, consecutiveFailures: s.consecutiveFailures, lastError: s.lastError, runs: s.runs };
  }
  return { ok, loops: out };
}

export function startHealthServer(port: number, sched: Scheduler, loops: LoopDef[], instance: string): Server {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/healthz")) {
      const r = healthReport(sched, loops);
      res.writeHead(r.ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ instance, ...r }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(port);
  return server;
}
