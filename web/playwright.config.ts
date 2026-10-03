import { defineConfig } from "@playwright/test";
// e2e against the local fork + API + web (SPEC "Integration tests"). The suite assumes `scripts/local-fork.sh --detach`,
// the API on :8083 and the indexer are running; `pnpm e2e` starts the web dev server itself.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 120_000, env: { NEXT_PUBLIC_DEV_SWAP: "1" } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
