import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT,
  applyBps,
  assertValidSplit,
  parseBtc,
  parseSats,
  sats,
  splitBtc,
  splitFee,
  toUi,
} from "../src/amounts";

describe("sats / parseSats", () => {
  it("accepts 0..u64 max and rejects outside", () => {
    expect(sats(0n)).toBe(0n);
    expect(sats(2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
    expect(() => sats(-1n)).toThrow(RangeError);
    expect(() => sats(2n ** 64n)).toThrow(RangeError);
  });
  it("parses API base-unit strings strictly", () => {
    expect(parseSats("123")).toBe(123n);
    for (const bad of ["", "1.0", "-1", "1e3", " 1", "0x10"]) expect(() => parseSats(bad)).toThrow(RangeError);
  });
});

describe("parseBtc / toUi round trip at 8 decimals", () => {
  it("parses user decimals exactly", () => {
    expect(parseBtc("1")).toBe(100_000_000n);
    expect(parseBtc("0.00000001")).toBe(1n);
    expect(parseBtc(".5")).toBe(50_000_000n);
    expect(parseBtc("0.001")).toBe(100_000n);
    expect(parseBtc("21000000")).toBe(2_100_000_000_000_000n);
  });
  it("refuses to round away precision", () => {
    expect(() => parseBtc("0.000000001")).toThrow(/decimal places/);
    for (const bad of ["", ".", "abc", "1,000", "-1", "1e-8"]) expect(() => parseBtc(bad)).toThrow(RangeError);
  });
  it("formats without trailing zeros and round-trips", () => {
    expect(toUi(100_000_000n)).toBe("1");
    expect(toUi(1n)).toBe("0.00000001");
    expect(toUi(0n)).toBe("0");
    expect(toUi(123_456_789n)).toBe("1.23456789");
    expect(toUi(-5n)).toBe("-0.00000005");
    for (const s of ["0.12345678", "42", "0.5", "7.00000001"]) expect(toUi(parseBtc(s))).toBe(s);
  });
  it("splits whole BTC and sats", () => {
    expect(splitBtc(sats(250_000_001n))).toEqual({ btc: 2n, sats: 50_000_001n });
  });
});

describe("bps math", () => {
  it("floors", () => {
    expect(applyBps(10_000n, 2500)).toBe(2_500n);
    expect(applyBps(3n, 2500)).toBe(0n);
    expect(applyBps(7n, 10_000)).toBe(7n);
    expect(() => applyBps(1n, 10_001)).toThrow(RangeError);
    expect(() => applyBps(1n, -1)).toThrow(RangeError);
  });
  it("splitFee parts always sum to the input; liquidity absorbs rounding so its floor holds (D7)", () => {
    for (const amt of [0n, 1n, 3n, 7n, 9_999n, 10_000n, 10_001n, 123_456_789n, 2n ** 64n - 1n]) {
      const s = splitFee(amt, DEFAULT_SPLIT);
      expect(s.liquidity + s.buyback + s.operator + s.deployer).toBe(amt);
      expect(s.liquidity).toBeGreaterThanOrEqual(applyBps(amt, DEFAULT_SPLIT.liquidityBps));
      expect(s.buyback).toBe(applyBps(amt, DEFAULT_SPLIT.buybackBps));
      expect(s.operator).toBe(applyBps(amt, DEFAULT_SPLIT.operatorBps));
      expect(s.deployer).toBe(applyBps(amt, DEFAULT_SPLIT.deployerBps));
    }
    expect(splitFee(10_000n, DEFAULT_SPLIT)).toEqual({ liquidity: 2_500n, buyback: 2_500n, operator: 1_000n, deployer: 4_000n });
    // 1 sat: every floored share is 0, the whole sat goes to liquidity
    expect(splitFee(1n, DEFAULT_SPLIT)).toEqual({ liquidity: 1n, buyback: 0n, operator: 0n, deployer: 0n });
    // 3 sats: deployer floor(1.2)=1, others 0, liquidity gets 2 (≥ floor(0.75)=0)
    expect(splitFee(3n, DEFAULT_SPLIT)).toEqual({ liquidity: 2n, buyback: 0n, operator: 0n, deployer: 1n });
  });
  it("enforces the spec bounds exactly at the edges", () => {
    expect(() => assertValidSplit(DEFAULT_SPLIT)).not.toThrow();
    // liquidity floor 2500
    expect(() => assertValidSplit({ liquidityBps: 2499, buybackBps: 2501, operatorBps: 1000, deployerBps: 4000 })).toThrow(/liquidity/);
    expect(() => assertValidSplit({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 2000, deployerBps: 3000 })).not.toThrow();
    // operator ceiling 2000
    expect(() => assertValidSplit({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 2001, deployerBps: 2999 })).toThrow(/operator/);
    // must sum to 10000
    expect(() => assertValidSplit({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4001 })).toThrow(/sum/);
    // no floor on deployer
    expect(() => assertValidSplit({ liquidityBps: 7500, buybackBps: 2500, operatorBps: 0, deployerBps: 0 })).not.toThrow();
    expect(() => assertValidSplit({ liquidityBps: 2500, buybackBps: -1, operatorBps: 0, deployerBps: 7501 })).toThrow(RangeError);
  });
});
