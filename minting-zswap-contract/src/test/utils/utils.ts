import { encodeRawTokenType } from "@midnight-ntwrk/compact-runtime";
import { ShieldedCoinInfo } from "../../managed/minting-zswap/contract";
import * as ledger from '@midnight-ntwrk/ledger-v6';

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHexPadded = (str: string, len = 64): string =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

export const randomSk = (): Uint8Array => crypto.getRandomValues(Buffer.alloc(32));

export const coin = (value: number): ShieldedCoinInfo => {
  return {
    nonce: randomSk(),
    color: encodeRawTokenType(ledger.shieldedToken().raw),
    value: BigInt(value),
  };
}

