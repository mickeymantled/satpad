import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RpcChainReader } from "../src/chain";

const account = (mint: PublicKey, owner: PublicKey, amount: bigint, program: PublicKey) => {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  return { data, owner: program, lamports: 1, executable: false, rentEpoch: 0 };
};

describe("RpcChainReader.tokenBalances", () => {
  it("unpacks Token and Token-2022 accounts (coin and LP accounts are Token-2022) and returns null for missing ones", async () => {
    const owner = Keypair.generate().publicKey;
    const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey, missing = Keypair.generate().publicKey;
    const conn = { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => (k.equals(a) ? account(Keypair.generate().publicKey, owner, 5n, TOKEN_PROGRAM_ID) : k.equals(b) ? account(Keypair.generate().publicKey, owner, 7n, TOKEN_2022_PROGRAM_ID) : null)) } as unknown as Connection;
    const r = new RpcChainReader(conn);
    expect(await r.tokenBalances([a, b, missing])).toEqual([5n, 7n, null]);
  });
});
