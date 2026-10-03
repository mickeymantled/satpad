// Coin metadata (DECISIONS D18, V16). Primary backend: pump.fun's IPFS upload, called server-side on the launcher's
// behalf (no CORS, undocumented). Fallback and fork path: Postgres rows served as Metaplex-style JSON + image at
// `/m/:id.json` and `/m/:id.png`. SPEC "Metadata": name ≤ 32 bytes, description ends with "Launched on satpad",
// an empty website links back to the coin's Satpad page.
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { coinMetadata, type Db } from "@satpad/db";

export const PUMP_IPFS_URL = "https://pump.fun/api/ipfs";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // V16: pump.fun 413s well below Vercel's limit; keep images < 4 MB
export const LAUNCHED_ON = "Launched on satpad";
const IMAGE_MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export type MetadataBackend = "pump" | "api";
export interface MetadataOptions { db: Db; backend: MetadataBackend; /** Public origin of this API, used for `/m/:id` URIs. */ publicUrl: string; /** Public origin of the web app, for the website back-link. */ webUrl: string; pumpUrl?: string; fetchImpl?: typeof fetch }
export interface MetadataInput { name: string; symbol: string; description?: string; image: string; imageMime?: string; twitter?: string; telegram?: string; website?: string; mint?: string }
export interface MetadataResult { uri: string; backend: MetadataBackend; id?: string; fallbackReason?: string }

export interface Normalized { name: string; symbol: string; description: string; image: Buffer; imageMime: string; twitter: string; telegram: string; website: string; mint: string }

/** Validates and normalizes the launch form; throws Error(message) on bad input. */
export function normalize(input: MetadataInput, webUrl: string): Normalized {
  const name = (input.name ?? "").trim(), symbol = (input.symbol ?? "").trim();
  if (!name || Buffer.byteLength(name, "utf8") > 32) throw new Error("name must be 1..32 bytes");
  if (!/^[A-Za-z0-9_.$-]{1,10}$/.test(symbol)) throw new Error("symbol must be 1..10 characters: letters, digits, _ . $ -");
  const mint = (input.mint ?? "").trim();
  if (mint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error("mint must be a base58 pubkey");
  let description = (input.description ?? "").trim();
  if (Buffer.byteLength(description, "utf8") > 1000) throw new Error("description must be ≤ 1000 bytes");
  if (!description.endsWith(LAUNCHED_ON)) description = description ? `${description} ${LAUNCHED_ON}` : LAUNCHED_ON;
  let imageMime = input.imageMime ?? "", b64 = input.image ?? "";
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/is.exec(b64);
  if (m) { imageMime = m[1]!.toLowerCase(); b64 = m[2]!; }
  if (!IMAGE_MIMES[imageMime]) throw new Error("image must be png, jpeg, gif or webp");
  const image = Buffer.from(b64.replace(/\s+/g, ""), "base64");
  if (image.length === 0) throw new Error("image is empty");
  if (image.length > MAX_IMAGE_BYTES) throw new Error(`image must be ≤ ${MAX_IMAGE_BYTES} bytes`);
  const url = (v: string | undefined, what: string) => { const t = (v ?? "").trim(); if (!t) return ""; if (!/^https?:\/\/[^\s]+$/i.test(t) || t.length > 200) throw new Error(`${what} must be an http(s) URL`); return t; };
  const website = url(input.website, "website") || (mint ? `${webUrl.replace(/\/$/, "")}/coin/${mint}` : "");
  return { name, symbol, description, image, imageMime, twitter: url(input.twitter, "twitter"), telegram: url(input.telegram, "telegram"), website, mint };
}

/** V16: multipart POST to pump.fun; returns `metadataUri` or throws. */
export async function uploadToPump(n: Normalized, pumpUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(n.image)], { type: n.imageMime }), `image.${IMAGE_MIMES[n.imageMime]}`);
  form.append("name", n.name); form.append("symbol", n.symbol); form.append("description", n.description);
  form.append("twitter", n.twitter); form.append("telegram", n.telegram); form.append("website", n.website); form.append("showName", "true");
  const res = await fetchImpl(pumpUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error(`pump ipfs ${res.status}`);
  const j = (await res.json()) as { metadataUri?: string };
  if (!j.metadataUri || !/^https?:\/\//.test(j.metadataUri)) throw new Error("pump ipfs: no metadataUri");
  return j.metadataUri;
}

export async function storeInApi(db: Db, n: Normalized, publicUrl: string): Promise<{ id: string; uri: string }> {
  const id = randomBytes(12).toString("hex");
  await db.insert(coinMetadata).values({ id, mint: n.mint || null, name: n.name, symbol: n.symbol, description: n.description, imageMime: n.imageMime, imageBase64: n.image.toString("base64"), twitter: n.twitter || null, telegram: n.telegram || null, website: n.website || null });
  return { id, uri: `${publicUrl.replace(/\/$/, "")}/m/${id}.json` };
}

export async function createMetadata(opts: MetadataOptions, input: MetadataInput): Promise<MetadataResult> {
  const n = normalize(input, opts.webUrl);
  if (opts.backend === "pump") {
    try { return { uri: await uploadToPump(n, opts.pumpUrl ?? PUMP_IPFS_URL, opts.fetchImpl ?? fetch), backend: "pump" }; }
    catch (e) { const r = await storeInApi(opts.db, n, opts.publicUrl); return { ...r, backend: "api", fallbackReason: (e as Error).message }; }
  }
  return { ...(await storeInApi(opts.db, n, opts.publicUrl)), backend: "api" };
}

export function registerMetadata(app: FastifyInstance, opts: MetadataOptions): void {
  const pub = opts.publicUrl.replace(/\/$/, "");
  app.post("/metadata", { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    let r: MetadataResult;
    try { r = await createMetadata(opts, (req.body ?? {}) as MetadataInput); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    reply.header("cache-control", "no-store");
    return r;
  });
  app.get("/m/:id.json", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = (await opts.db.select().from(coinMetadata).where(eq(coinMetadata.id, id)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: "not found" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return { name: row.name, symbol: row.symbol, description: row.description, image: `${pub}/m/${id}.png`, showName: true, createdOn: opts.webUrl, ...(row.twitter && { twitter: row.twitter }), ...(row.telegram && { telegram: row.telegram }), ...(row.website && { website: row.website }) };
  });
  app.get("/m/:id.png", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = (await opts.db.select({ mime: coinMetadata.imageMime, b64: coinMetadata.imageBase64 }).from(coinMetadata).where(eq(coinMetadata.id, id)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: "not found" });
    reply.header("cache-control", "public, max-age=31536000, immutable").type(row.mime);
    return reply.send(Buffer.from(row.b64, "base64"));
  });
}
