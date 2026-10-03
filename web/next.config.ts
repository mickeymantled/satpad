import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // D17: define the dev-swap flag for every build ("" when unset) so `process.env.NEXT_PUBLIC_DEV_SWAP === "1"` is a
  // compile-time constant and the bundler drops the devSwap branch (and chunk) from production output.
  env: { NEXT_PUBLIC_DEV_SWAP: process.env["NEXT_PUBLIC_DEV_SWAP"] === "1" ? "1" : "" },
  /* config options here */
};

export default nextConfig;
