// Read-side chain access the loops need, as a small interface so tests can script balances without an RPC.
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, unpackAccount } from "@solana/spl-token";
import { BTC_QUOTE_TOKEN_PROGRAM, configPda, decodeConfig, type Config } from "@satpad/sdk";

export interface ChainReader {
  /** Token balance in base units, or null when the account does not exist. */
  tokenBalance(ata: PublicKey): Promise<bigint | null>;
  tokenBalances(atas: PublicKey[]): Promise<(bigint | null)[]>;
  vaultConfig(): Promise<Config>;
  /** Total supply of a mint (LP-supply guard, SPEC "Published addresses"). */
  mintSupply(mint: PublicKey, tokenProgram: PublicKey): Promise<bigint>;
  slot(): Promise<bigint>;
}

export class RpcChainReader implements ChainReader {
  constructor(private readonly conn: Connection) {}
  async tokenBalance(ata: PublicKey): Promise<bigint | null> {
    return (await this.tokenBalances([ata]))[0]!;
  }
  async tokenBalances(atas: PublicKey[]): Promise<(bigint | null)[]> {
    const out: (bigint | null)[] = [];
    for (let i = 0; i < atas.length; i += 100) {
      const chunk = atas.slice(i, i + 100);
      const infos = await this.conn.getMultipleAccountsInfo(chunk, "confirmed");
      infos.forEach((info, j) => out.push(info ? unpackAccount(chunk[j]!, info, BTC_QUOTE_TOKEN_PROGRAM).amount : null));
    }
    return out;
  }
  async mintSupply(mint: PublicKey, tokenProgram: PublicKey): Promise<bigint> {
    return (await getMint(this.conn, mint, "confirmed", tokenProgram)).supply;
  }
  async vaultConfig(): Promise<Config> {
    const info = await this.conn.getAccountInfo(configPda()[0], "confirmed");
    if (!info) throw new Error("satpad_vault Config not found — run scripts/vault-initialize.ts");
    return decodeConfig(info.data);
  }
  async slot(): Promise<bigint> {
    return BigInt(await this.conn.getSlot("confirmed"));
  }
}
