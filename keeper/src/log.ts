// Structured JSON logs on stdout (Railway collects stdout). No logging library: one line per event, never secrets.
export type Level = "debug" | "info" | "warn" | "error";
export interface Logger { child(fields: Record<string, unknown>): Logger; debug(msg: string, f?: Record<string, unknown>): void; info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void }

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(base: Record<string, unknown> = {}, level: Level = (process.env["LOG_LEVEL"] as Level) ?? "info", sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const emit = (lvl: Level, msg: string, f?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...f }, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Error ? { name: v.name, message: v.message } : v)));
  };
  return {
    child: (fields) => createLogger({ ...base, ...fields }, level, sink),
    debug: (m, f) => emit("debug", m, f), info: (m, f) => emit("info", m, f), warn: (m, f) => emit("warn", m, f), error: (m, f) => emit("error", m, f),
  };
}
