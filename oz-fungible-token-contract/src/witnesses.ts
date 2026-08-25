import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/fungible-token/contract/index.js";

/**
 * Both OpenZeppelin modules used by this contract derive the caller's identity
 * from a secret key rather than from a transaction signature. `Ownable` computes
 * `persistentHash(secretKey)` and compares it against the stored owner; the
 * `FungibleToken` module derives the caller's account id the same way.
 *
 * That means a single 32-byte secret is the whole private state, and BOTH
 * witnesses read it.
 *
 * A witness runs in the caller's wallet, off-chain, and the contract cannot
 * verify that it behaves. Whoever supplies a secret key here is claiming an
 * identity; the circuit only checks that the derived hash matches. Keep it
 * secret, and treat this file as security-critical.
 */
export type FungibleTokenPrivateState = {
  /** 32-byte secret from which this caller's on-chain identity is derived. */
  readonly secretKey: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array
): FungibleTokenPrivateState => ({ secretKey });

export const witnesses = {
  /** Identity used by `Ownable_assertOnlyOwner`. */
  wit_OwnableSK: ({
    privateState
  }: WitnessContext<Ledger, FungibleTokenPrivateState>): [
    FungibleTokenPrivateState,
    Uint8Array
  ] => [privateState, privateState.secretKey],

  /** Identity used by the `FungibleToken` module's account derivation. */
  wit_FungibleTokenSK: ({
    privateState
  }: WitnessContext<Ledger, FungibleTokenPrivateState>): [
    FungibleTokenPrivateState,
    Uint8Array
  ] => [privateState, privateState.secretKey]
};
