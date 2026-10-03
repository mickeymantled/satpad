import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"], environment: "node",
    // pump's SDKs do named ESM imports from the CJS @coral-xyz/anchor build (DECISIONS D6/D10).
    server: { deps: { inline: ["@pump-fun/pump-sdk", "@pump-fun/pump-swap-sdk", "@pump-fun/agent-payments-sdk"] } },
  },
});
