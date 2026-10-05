// Read-side chain access the loops need, as a small interface so tests can script balances without an RPC.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint, unpackAccount } from "@solana/spl-token";
import { BTC_QUOTE_TOKEN_PROGRAM, configPda, decodeConfig, type Config } from "@satpad/sdk";

export interface ChainReader {
  /** Token balance in base units, or null when the account does not exist. */
  tokenBalance(ata: PublicKey): Promise<bigint | null>;
  tokenBalances(atas: PublicKey[]): Promise<(bigint | null)[]>;
  vaultConfig(): Promise<Config>;
  /** Cluster time in seconds (block time of the latest slot): on-chain interval gates must use this, not the host clock. */
  unixTime(): Promise<number>;
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
      // Token accounts may belong to Token or Token-2022 (coin and LP accounts are Token-2022): unpack with the real owner.
      infos.forEach((info, j) => {
        if (!info) return out.push(null);
        const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : BTC_QUOTE_TOKEN_PROGRAM;
        out.push(unpackAccount(chunk[j]!, info, program).amount);
      });
    }
    return out;
  }
  async unixTime(): Promise<number> {
    const t = await this.conn.getBlockTime(await this.conn.getSlot("confirmed"));
    if (t === null) throw new Error("block time unavailable");
    return t;
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
