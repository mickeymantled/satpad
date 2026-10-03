"use client";
// WS /live subscription (trade + new-coin events from the indexer via the API). Reconnects with backoff; keeps the
// last N events for the ticker. Pure parsing lives in parseLiveEvent so it is unit-testable without a browser.
import { useEffect, useRef, useState } from "react";
import { env } from "./env";

export type LiveEvent =
  | { kind: "hello"; clients: number }
  | { kind: "trade"; mint: string; side: "buy" | "sell"; btc: string; tokens: string; trader: string; signature: string; slot: string }
  | { kind: "coin"; mint: string; symbol: string | null; slot: string };

export function parseLiveEvent(raw: string): LiveEvent | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o["kind"] === "trade" && typeof o["mint"] === "string" && (o["side"] === "buy" || o["side"] === "sell") && /^\d+$/.test(String(o["btc"]))) return o as unknown as LiveEvent;
    if (o["kind"] === "coin" && typeof o["mint"] === "string") return o as unknown as LiveEvent;
    if (o["kind"] === "hello") return o as unknown as LiveEvent;
    return null;
  } catch { return null; }
}

export function useLive(keep = 50): { events: LiveEvent[]; connected: boolean } {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const attempt = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null; let closed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      ws = new WebSocket(env.wsUrl);
      ws.onopen = () => { attempt.current = 0; setConnected(true); };
      ws.onmessage = (m) => { const e = parseLiveEvent(String(m.data)); if (e && e.kind !== "hello") setEvents((prev) => [e, ...prev].slice(0, keep)); };
      ws.onclose = () => { setConnected(false); if (!closed) timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** attempt.current++)); };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [keep]);
  return { events, connected };
}
