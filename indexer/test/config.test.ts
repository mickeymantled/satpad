import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
const base = { SOLANA_RPC_URL: "http://127.0.0.1:8899", DATABASE_URL: "postgres://x" };
describe("indexer config", () => {
  it("defaults are conservative and webhook needs an auth header", () => {
    const c = loadConfig(base);
    expect(c.rpcRatePerSecond).toBe(4); expect(c.pollIntervalMs).toBe(5000); expect(c.webhookPort).toBeNull();
    expect(() => loadConfig({ ...base, WEBHOOK_PORT: "9000" })).toThrow(/WEBHOOK_AUTH_HEADER/);
    expect(loadConfig({ ...base, WEBHOOK_PORT: "9000", WEBHOOK_AUTH_HEADER: "s", EXTRA_ADDRESSES: "a, b" }).extraAddresses).toEqual(["a", "b"]);
  });
});
