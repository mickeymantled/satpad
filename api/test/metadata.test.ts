import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { DEFAULT_LOCAL_DATABASE_URL, connect, type Db } from "@satpad/db";
import { runMigrations } from "@satpad/db/src/migrate";
import type { FastifyInstance } from "fastify";
import { LAUNCHED_ON, MAX_IMAGE_BYTES, normalize } from "../src/metadata";
import { buildApp } from "../src/app";
import { FixedPriceProvider } from "../src/prices";

const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
const reachable = async () => { const c = new Client({ connectionString: BASE }); try { await c.connect(); await c.end(); return true; } catch { return false; } };
// 1×1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const MINT = "DXj9KNaxsKiRnQoMPRgupqC4XECrGbL8EnQ2MiuPZrt2";

describe("metadata normalize (SPEC Metadata)", () => {
  it("appends the provenance line, defaults the website to the coin page, keeps a user website", () => {
    const n = normalize({ name: "Satoshi Cat", symbol: "SCAT", description: "meow", image: `data:image/png;base64,${PNG}`, mint: MINT }, "https://satpad.example/");
    expect(n.description).toBe(`meow ${LAUNCHED_ON}`);
    expect(n.website).toBe(`https://satpad.example/coin/${MINT}`);
    expect(n.imageMime).toBe("image/png");
    expect(n.image.length).toBe(Buffer.from(PNG, "base64").length);
    expect(normalize({ name: "a", symbol: "A", image: PNG, imageMime: "image/png", website: "https://x.y" }, "w").website).toBe("https://x.y");
    expect(normalize({ name: "a", symbol: "A", image: PNG, imageMime: "image/png", description: `already ${LAUNCHED_ON}` }, "w").description).toBe(`already ${LAUNCHED_ON}`);
  });
  it("rejects bad names, symbols, images and urls", () => {
    const ok = { name: "a", symbol: "A", image: PNG, imageMime: "image/png" };
    expect(() => normalize({ ...ok, name: "x".repeat(33) }, "w")).toThrow(/32 bytes/);
    expect(() => normalize({ ...ok, name: "ünïcödé-is-long-enough-to-fail-32" }, "w")).toThrow(/32 bytes/);
    expect(() => normalize({ ...ok, symbol: "TOO LONG SYMBOL" }, "w")).toThrow(/symbol/);
    expect(() => normalize({ ...ok, imageMime: "image/svg+xml" }, "w")).toThrow(/png, jpeg/);
    expect(() => normalize({ ...ok, image: "" }, "w")).toThrow(/empty/);
    expect(() => normalize({ ...ok, image: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64") }, "w")).toThrow(/≤/);
    expect(() => normalize({ ...ok, twitter: "javascript:alert(1)" }, "w")).toThrow(/twitter/);
    expect(() => normalize({ ...ok, mint: "nope" }, "w")).toThrow(/mint/);
  });
});

describe("metadata routes (Postgres)", async () => {
  if (!(await reachable())) { it.skip("Postgres not reachable", () => {}); return; }
  const name = `satpad_meta_${process.pid}`; const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  let db: Db, close: () => Promise<void>;
  const pumpCalls: { form: FormData }[] = [];
  let pumpOk = true;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    pumpCalls.push({ form: init!.body as FormData });
    return pumpOk ? new Response(JSON.stringify({ metadataUri: "https://ipfs.io/ipfs/QmTest" }), { status: 200 }) : new Response("nope", { status: 500 });
  }) as typeof fetch;
  const build = (backend: "pump" | "api") => buildApp({ db, prices: new FixedPriceProvider(100_000_00n), metadata: { backend, publicUrl: "http://api.test", webUrl: "http://web.test", pumpUrl: "https://pump.test/ipfs", fetchImpl }, jupiter: null });
  let apiApp: FastifyInstance, pumpApp: FastifyInstance;
  beforeAll(async () => {
    const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`CREATE DATABASE ${name}`); await a.end();
    await runMigrations(url); ({ db, close } = connect(url));
    apiApp = await build("api"); pumpApp = await build("pump");
  });
  afterAll(async () => { await apiApp.close(); await pumpApp.close(); await close(); const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`DROP DATABASE ${name}`); await a.end(); });
  const payload = { name: "Satoshi Cat", symbol: "SCAT", description: "meow", image: `data:image/png;base64,${PNG}`, twitter: "https://x.com/scat", mint: MINT };

  it("api backend: stores the row and serves Metaplex-style JSON and the image", async () => {
    const r = await apiApp.inject({ method: "POST", url: "/metadata", payload });
    expect(r.statusCode).toBe(200);
    const { uri, backend, id } = r.json() as { uri: string; backend: string; id: string };
    expect(backend).toBe("api");
    expect(uri).toBe(`http://api.test/m/${id}.json`);
    const j = await apiApp.inject({ method: "GET", url: `/m/${id}.json` });
    expect(j.statusCode).toBe(200);
    expect(j.json()).toMatchObject({ name: "Satoshi Cat", symbol: "SCAT", description: `meow ${LAUNCHED_ON}`, image: `http://api.test/m/${id}.png`, showName: true, twitter: "https://x.com/scat", website: `http://web.test/coin/${MINT}` });
    expect(j.headers["cache-control"]).toContain("immutable");
    const p = await apiApp.inject({ method: "GET", url: `/m/${id}.png` });
    expect(p.statusCode).toBe(200);
    expect(p.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(p.rawPayload).equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect((await apiApp.inject({ method: "GET", url: "/m/nope.json" })).statusCode).toBe(404);
    expect((await apiApp.inject({ method: "GET", url: "/config" })).json()).toMatchObject({ metadataBackend: "api", webUrl: "http://web.test", launchAlt: null });
  });
  it("rejects invalid input with 400", async () => {
    const r = await apiApp.inject({ method: "POST", url: "/metadata", payload: { ...payload, name: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/name/);
  });
  it("pump backend: multipart upload to pump.fun, uri = metadataUri verbatim; falls back to api on failure", async () => {
    pumpOk = true;
    const r = await pumpApp.inject({ method: "POST", url: "/metadata", payload });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ uri: "https://ipfs.io/ipfs/QmTest", backend: "pump" });
    const form = pumpCalls[0]!.form;
    expect(form.get("name")).toBe("Satoshi Cat");
    expect(form.get("description")).toBe(`meow ${LAUNCHED_ON}`);
    expect(form.get("website")).toBe(`http://web.test/coin/${MINT}`);
    expect(form.get("showName")).toBe("true");
    expect((form.get("file") as File).type).toBe("image/png");
    pumpOk = false;
    const f = await pumpApp.inject({ method: "POST", url: "/metadata", payload });
    expect(f.statusCode).toBe(200);
    expect(f.json()).toMatchObject({ backend: "api", fallbackReason: "pump ipfs 500" });
    expect(f.json().uri).toMatch(/^http:\/\/api\.test\/m\/[0-9a-f]{24}\.json$/);
    expect((await pumpApp.inject({ method: "GET", url: "/config" })).json().metadataBackend).toBe("pump");
  });
});
