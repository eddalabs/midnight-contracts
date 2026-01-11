import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type ShieldedCoinInfo = { nonce: Uint8Array;
                                 color: Uint8Array;
                                 value: bigint
                               };

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  mint(context: __compactRuntime.CircuitContext<PS>, coin_0: ShieldedCoinInfo): __compactRuntime.CircuitResults<PS, []>;
  burn(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  owner_withdraw(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  mint(context: __compactRuntime.CircuitContext<PS>, coin_0: ShieldedCoinInfo): __compactRuntime.CircuitResults<PS, []>;
  burn(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  owner_withdraw(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly counter: bigint;
  readonly nonce: Uint8Array;
  readonly tvl_token: bigint;
  readonly reward: { nonce: Uint8Array,
                     color: Uint8Array,
                     value: bigint,
                     mt_index: bigint
                   };
  readonly tvl_dust: bigint;
  readonly owner_public_key: { bytes: Uint8Array };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initNonce_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
