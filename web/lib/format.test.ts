import { describe, expect, it } from "vitest";
import { ago, btc, money, pct, sats, short, tokens, usd, usdCompact } from "./format";
import { parseLiveEvent } from "./live";

describe("format", () => {
  it("btc/sats/usd from base units, no float money", () => {
    expect(btc("123456789")).toBe("1.23456789 BTC");
    expect(btc("100000000")).toBe("1 BTC");
    expect(btc("1", 8)).toBe("0.00000001 BTC");
    expect(btc("123456789", 4)).toBe("1.2345 BTC");
    expect(sats("123456789")).toBe("123,456,789 sats");
    expect(usd({ base: "1", ui: "0.00000001", usd: "1234.5" })).toBe("$1,234.50");
    expect(usd({ base: "1", ui: "0.00000001" })).toBe("—");
    expect(usd("100000000", "10000000")).toBe("$100,000.00");
    expect(money({ base: "2500", ui: "0.000025", usd: "2.50" })).toEqual({ btc: "0.000025 BTC", sats: "2,500 sats", usd: "$2.50" });
  });
  it("tokens, pct, short, compact, ago", () => {
    expect(tokens("1000500000")).toBe("1,000.5");
    expect(pct(5000)).toBe("50%"); expect(pct(221)).toBe("2.2%");
    expect(short("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh")).toBe("3NZ9…qmJh");
    expect(usdCompact({ base: "0", ui: "0", usd: "1234567.00" })).toBe("$1.23M");
    expect(usdCompact({ base: "0", ui: "0", usd: "999.99" })).toBe("$999.99");
    expect(ago(new Date(Date.now() - 90_000).toISOString())).toBe("1m ago");
    expect(ago(null)).toBe("—");
  });
});

describe("parseLiveEvent", () => {
  it("accepts well-formed trade/coin/hello events and rejects garbage", () => {
    expect(parseLiveEvent(JSON.stringify({ kind: "trade", mint: "M", side: "buy", btc: "7", tokens: "1", trader: "T", signature: "s", slot: "1" }))).toMatchObject({ kind: "trade", btc: "7" });
    expect(parseLiveEvent(JSON.stringify({ kind: "coin", mint: "M", symbol: null, slot: "1" }))).toMatchObject({ kind: "coin" });
    expect(parseLiveEvent(JSON.stringify({ kind: "trade", mint: "M", side: "steal", btc: "7" }))).toBeNull();
    expect(parseLiveEvent("not json")).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ kind: "trade", mint: "M", side: "buy", btc: "1.5" }))).toBeNull();
  });
});
