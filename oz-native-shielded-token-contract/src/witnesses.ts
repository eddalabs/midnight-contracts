import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/native-shielded-token/contract/index.js";

/**
 * The native shielded token module needs no private state of its own: coins
 * live in wallets, not in a balance map, so there is no account identity to
 * prove. The single witness here belongs to `Ownable`, which identifies the
 * owner as `persistentHash(secretKey)`.
 *
 * A witness runs off-chain in the caller's wallet and the contract cannot
 * verify it behaves. Supplying a secret key claims the identity it hashes to.
 */
export type NativeShieldedTokenPrivateState = {
  /** 32-byte secret from which the owner's account id is derived. */
  readonly secretKey: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array
): NativeShieldedTokenPrivateState => ({ secretKey });

export const witnesses = {
  wit_OwnableSK: ({
    privateState
  }: WitnessContext<Ledger, NativeShieldedTokenPrivateState>): [
    NativeShieldedTokenPrivateState,
    Uint8Array
  ] => [privateState, privateState.secretKey]
};
