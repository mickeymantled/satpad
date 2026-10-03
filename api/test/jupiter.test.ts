import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { registerJupiter, WSOL_MINT } from "../src/jupiter";

const fixture = (n: string) => readFileSync(join(__dirname, "..", "..", "web", "test", "fixtures", "jupiter", n), "utf8");

function build(opts: { apiKey?: string; fail?: boolean } = {}) {
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, ...(init && { init }) });
    if (opts.fail) return { ok: false, status: 429, text: async () => "rate limited" };
    const body = url.includes("/quote?") ? fixture("q_100000000.json") : fixture("si_100000000.json");
    return { ok: true, status: 200, text: async () => body };
  }) as unknown as typeof fetch;
  const app = Fastify();
  registerJupiter(app, { baseUrl: "https://jup.test/v1", fetchImpl, ...(opts.apiKey && { apiKey: opts.apiKey }) });
  return { app, calls };
}

describe("jupiter proxy (V10)", () => {
  it("quotes SOL → wBTC only, pins the pair and forwards the api key", async () => {
    const { app, calls } = build({ apiKey: "k" });
    const r = await app.inject({ method: "GET", url: "/swap/quote?lamports=100000000" });
    expect(r.statusCode).toBe(200);
    expect(r.json().outAmount).toBe("14107");
    expect(calls[0]!.url).toContain(`inputMint=${WSOL_MINT}&outputMint=3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh&amount=100000000&slippageBps=50`);
    expect(calls[0]!.init?.headers?.["x-api-key"]).toBe("k");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("rejects bad amounts", async () => {
    const { app } = build();
    for (const q of ["", "lamports=abc", "lamports=0", "lamports=-1", "lamports=100000000001"]) expect((await app.inject({ method: "GET", url: `/swap/quote?${q}` })).statusCode).toBe(400);
  });
  it("builds swap instructions with wrap/unwrap and dynamic CU, refusing foreign pairs", async () => {
    const { app, calls } = build();
    const quoteResponse = JSON.parse(fixture("q_100000000.json"));
    const user = Keypair.generate().publicKey.toBase58();
    const r = await app.inject({ method: "POST", url: "/swap/instructions", payload: { quoteResponse, userPublicKey: user } });
    expect(r.statusCode).toBe(200);
    expect(r.json().addressLookupTableAddresses).toHaveLength(3);
    const sent = JSON.parse(calls[0]!.init!.body!);
    expect(sent).toMatchObject({ userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true });
    expect(calls[0]!.url).toBe("https://jup.test/v1/swap-instructions");
    const bad = await app.inject({ method: "POST", url: "/swap/instructions", payload: { quoteResponse: { ...quoteResponse, outputMint: WSOL_MINT }, userPublicKey: user } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/swap/instructions", payload: { userPublicKey: user } })).statusCode).toBe(400);
  });
  it("maps upstream failures to 502 without leaking the key", async () => {
    const { app } = build({ apiKey: "secret", fail: true });
    const r = await app.inject({ method: "GET", url: "/swap/quote?lamports=1000" });
    expect(r.statusCode).toBe(502);
    expect(r.body).toContain("jupiter 429");
    expect(r.body).not.toContain("secret");
  });
});
