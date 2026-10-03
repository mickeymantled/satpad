import { env } from "./env";
const cluster = env.cluster === "mainnet-beta" || env.cluster === "custom" && env.rpcUrl.includes("mainnet") ? "" : env.cluster === "custom" ? `?cluster=custom&customUrl=${encodeURIComponent(env.rpcUrl)}` : `?cluster=${env.cluster}`;
export const explorerAccount = (pk: string) => `${env.explorer}/account/${pk}${cluster}`;
export const explorerTx = (sig: string) => `${env.explorer}/tx/${sig}${cluster}`;
export const coinUrl = (mint: string) => `/coin/${mint}`;
