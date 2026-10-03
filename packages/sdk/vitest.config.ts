import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // pump's SDKs do named ESM imports (e.g. `{ BN }`) from the CJS @coral-xyz/anchor build, which Node's
    // native ESM loader rejects. Inlining lets Vite's interop resolve them. Same root cause as DECISIONS D6.
    server: { deps: { inline: ["@pump-fun/pump-sdk", "@pump-fun/pump-swap-sdk", "@pump-fun/agent-payments-sdk"] } },
  },
});
