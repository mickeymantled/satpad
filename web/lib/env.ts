// Public runtime configuration. Only NEXT_PUBLIC_* values reach the browser; no secrets live here.
export const env = {
  apiUrl: process.env["NEXT_PUBLIC_API_URL"] ?? "http://127.0.0.1:8083",
  wsUrl: process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://127.0.0.1:8083/live",
  rpcUrl: process.env["NEXT_PUBLIC_RPC_URL"] ?? "http://127.0.0.1:8899",
  /** Address of the launch lookup table created once per deployment (DECISIONS D14). */
  launchAlt: process.env["NEXT_PUBLIC_LAUNCH_ALT"] ?? "",
  /** Fork-only faucet swap (D17). The module is excluded from production bundles by the build check. */
  devSwap: process.env["NEXT_PUBLIC_DEV_SWAP"] === "1",
  explorer: process.env["NEXT_PUBLIC_EXPLORER"] ?? "https://solscan.io",
  cluster: process.env["NEXT_PUBLIC_CLUSTER"] ?? "custom",
} as const;
