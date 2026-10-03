// Jupiter swap proxy (V10). The browser never talks to Jupiter directly: the optional JUPITER_API_KEY stays here and
// the allowed pair is pinned to SOL → BTC_QUOTE_MINT so the proxy cannot be used as a general router.
import type { FastifyInstance } from "fastify";
import { BTC_QUOTE_MINT } from "@satpad/sdk";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const JUPITER_DEFAULT_URL = "https://api.jup.ag/swap/v1";
export const MAX_SWAP_LAMPORTS = 100_000_000_000n; // 100 SOL: a UI swap, not a treasury move

export interface JupiterOptions { baseUrl?: string; apiKey?: string; fetchImpl?: typeof fetch }

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function registerJupiter(app: FastifyInstance, opts: JupiterOptions = {}): void {
  const base = (opts.baseUrl ?? JUPITER_DEFAULT_URL).replace(/\/$/, "");
  const f = (opts.fetchImpl ?? fetch) as unknown as FetchLike;
  const headers = (): Record<string, string> => ({ accept: "application/json", ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}) });
  const upstream = async (res: { ok: boolean; status: number; text(): Promise<string> }) => {
    const text = await res.text();
    if (!res.ok) return { code: 502, body: { error: `jupiter ${res.status}`, detail: text.slice(0, 500) } };
    try { return { code: 200, body: JSON.parse(text) as unknown }; } catch { return { code: 502, body: { error: "jupiter returned non-JSON" } }; }
  };

  // GET /swap/quote?lamports=<n>&slippageBps=<bps>  → Jupiter quoteResponse for SOL → wBTC (ExactIn).
  app.get("/swap/quote", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    let lamports: bigint;
    try { lamports = BigInt(q["lamports"] ?? ""); } catch { return reply.code(400).send({ error: "lamports must be an integer" }); }
    if (lamports <= 0n || lamports > MAX_SWAP_LAMPORTS) return reply.code(400).send({ error: `lamports must be in 1..${MAX_SWAP_LAMPORTS}` });
    const slippageBps = Math.min(1000, Math.max(1, Number(q["slippageBps"] ?? 50) || 50));
    const url = `${base}/quote?inputMint=${WSOL_MINT}&outputMint=${BTC_QUOTE_MINT.toBase58()}&amount=${lamports}&slippageBps=${slippageBps}&swapMode=ExactIn`;
    const r = await upstream(await f(url, { headers: headers() }));
    reply.header("cache-control", "no-store");
    return reply.code(r.code).send(r.body);
  });

  // POST /swap/instructions {quoteResponse, userPublicKey} → Jupiter swap-instructions (wrap/unwrap SOL, dynamic CU).
  app.post("/swap/instructions", async (req, reply) => {
    const b = (req.body ?? {}) as { quoteResponse?: { inputMint?: string; outputMint?: string }; userPublicKey?: string };
    if (!b.quoteResponse || typeof b.userPublicKey !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.userPublicKey)) return reply.code(400).send({ error: "quoteResponse and userPublicKey required" });
    if (b.quoteResponse.inputMint !== WSOL_MINT || b.quoteResponse.outputMint !== BTC_QUOTE_MINT.toBase58()) return reply.code(400).send({ error: "only SOL → BTC quotes are accepted" });
    const body = JSON.stringify({ quoteResponse: b.quoteResponse, userPublicKey: b.userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 0 });
    const r = await upstream(await f(`${base}/swap-instructions`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body }));
    reply.header("cache-control", "no-store");
    return reply.code(r.code).send(r.body);
  });
}
