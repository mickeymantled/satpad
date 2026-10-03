import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { describeConfig, loadConfig } from "../src/config";
import { loadKeypair } from "../src/keys";

const base = { SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=SECRET", DATABASE_URL: "postgres://u:pw@h/db", KEEPER_KEYPAIR: "/k.json" };

describe("config", () => {
  it("loads defaults and parses bigint thresholds", () => {
    const c = loadConfig(base);
    expect(c.settleDustThreshold).toBe(1_000n);
    expect(c.maxSendAttempts).toBe(5);
    expect(c.priorityFeeMode).toBe("fixed");
  });
  it("rejects missing required, bad numbers, and more than 5 attempts", () => {
    expect(() => loadConfig({ ...base, SOLANA_RPC_URL: "" })).toThrow(/SOLANA_RPC_URL/);
    expect(() => loadConfig({ ...base, SETTLE_DUST_THRESHOLD: "1.5" })).toThrow(/base-unit integer/);
    expect(() => loadConfig({ ...base, MAX_SEND_ATTEMPTS: "6" })).toThrow(/1..5/);
    expect(() => loadConfig({ ...base, PRIORITY_FEE_MODE: "guess" })).toThrow(/helius\|fixed/);
  });
  it("describeConfig redacts the API key and DB password", () => {
    const d = JSON.stringify(describeConfig(loadConfig(base)), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(d).not.toContain("SECRET");
    expect(d).not.toContain(":pw@");
  });
});

describe("keys", () => {
  it("loads a 64-byte JSON keypair and rejects anything else", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "satpad-keys-"));
    const kp = Keypair.generate();
    const good = path.join(dir, "good.json");
    writeFileSync(good, JSON.stringify(Array.from(kp.secretKey)));
    expect(loadKeypair(good).publicKey.equals(kp.publicKey)).toBe(true);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([1, 2, 3]));
    expect(() => loadKeypair(bad)).toThrow(/64-byte/);
    expect(() => loadKeypair(path.join(dir, "missing.json"))).toThrow(/cannot read/);
  });
});
