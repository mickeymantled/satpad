import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, server: { deps: { inline: ["@pump-fun/pump-sdk", "@pump-fun/pump-swap-sdk", "@pump-fun/agent-payments-sdk"] } } },
});
