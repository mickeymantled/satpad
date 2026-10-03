import { describe, expect, it } from "vitest";
import {
  GLOBAL_PDA,
  MAYHEM_PROGRAM_ID as SDK_MAYHEM_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID as SDK_PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID as SDK_PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID as SDK_PUMP_PROGRAM_ID,
  QUOTE_CONTROL_PDA,
} from "@pump-fun/pump-sdk";
import {
  BTC_INITIAL_VIRTUAL_QUOTE_RESERVES,
  BTC_QUOTE_DECIMALS,
  BTC_QUOTE_MINT,
  DEFAULT_CREATOR_FEE_BPS,
  MAX_CREATOR_FEE_BPS,
  MAYHEM_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  PUMP_GLOBAL,
  PUMP_PROGRAM_ID,
  PUMP_QUOTE_CONTROL,
  SATS_PER_BTC,
} from "../src/quoteMints";

describe("quoteMints", () => {
  it("pins the human-approved wBTC mint (DECISIONS D2)", () => {
    expect(BTC_QUOTE_MINT.toBase58()).toBe("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
  });

  it("uses 8 decimals and 1e8 sats per BTC", () => {
    expect(BTC_QUOTE_DECIMALS).toBe(8);
    expect(SATS_PER_BTC).toBe(10n ** BigInt(BTC_QUOTE_DECIMALS));
    expect(BTC_INITIAL_VIRTUAL_QUOTE_RESERVES).toBe(5_082_192n);
  });

  it("creator fee default is within the program ceiling (DECISIONS D3)", () => {
    expect(DEFAULT_CREATOR_FEE_BPS).toBe(100);
    expect(MAX_CREATOR_FEE_BPS).toBe(100);
    expect(DEFAULT_CREATOR_FEE_BPS).toBeLessThanOrEqual(MAX_CREATOR_FEE_BPS);
    expect(DEFAULT_CREATOR_FEE_BPS).toBeGreaterThanOrEqual(1);
  });

  it("program ids and singleton PDAs match @pump-fun/pump-sdk 2.0.0", () => {
    expect(PUMP_PROGRAM_ID.equals(SDK_PUMP_PROGRAM_ID)).toBe(true);
    expect(PUMP_FEES_PROGRAM_ID.equals(SDK_PUMP_FEE_PROGRAM_ID)).toBe(true);
    expect(PUMP_AMM_PROGRAM_ID.equals(SDK_PUMP_AMM_PROGRAM_ID)).toBe(true);
    expect(MAYHEM_PROGRAM_ID.equals(SDK_MAYHEM_PROGRAM_ID)).toBe(true);
    expect(GLOBAL_PDA.equals(PUMP_GLOBAL)).toBe(true);
    expect(QUOTE_CONTROL_PDA.equals(PUMP_QUOTE_CONTROL)).toBe(true);
  });
});
