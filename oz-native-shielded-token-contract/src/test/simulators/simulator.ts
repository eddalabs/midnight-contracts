// Adapted from the CounterSimulator pattern in this repo, which is itself
// adapted from midnightntwrk/example-counter (Apache-2.0). See docs.md § 10.

import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";

import {
  Contract,
  type Ledger,
  type ShieldedCoinInfo,
  type QualifiedShieldedCoinInfo,
  ledger
} from "../../managed/native-shielded-token/contract/index.js";
import {
  type NativeShieldedTokenPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  type CoinPublicKey,
  type ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

/** `Either<Bytes<32>, ContractAddress>`, how the module identifies an owner. */
export type Account = {
  is_left: boolean;
  left: Uint8Array;
  right: { bytes: Uint8Array };
};

/** `Either<ZswapCoinPublicKey, ContractAddress>`, how a coin recipient is named. */
export type CoinRecipient = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};

export class NativeShieldedTokenSimulator {
  readonly contract: Contract<NativeShieldedTokenPrivateState>;
  circuitContext: CircuitContext<NativeShieldedTokenPrivateState>;
  userPrivateStates: Record<string, NativeShieldedTokenPrivateState>;
  updateUserPrivateState: (ps: NativeShieldedTokenPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(
    privateState: NativeShieldedTokenPrivateState,
    domainSep: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    initialOwner: Account,
    coinPK: CoinPublicKey
  ) {
    this.contract = new Contract<NativeShieldedTokenPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(privateState, coinPK),
      domainSep,
      name,
      symbol,
      decimals,
      initialOwner
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(
        currentContractState.data,
        this.contractAddress
      ),
      costModel: CostModel.initialCostModel()
    };
    this.userPrivateStates = { deployer: currentPrivateState };
    this.updateUserPrivateState = () => {};
  }

  static deploy(args: {
    domainSep: Uint8Array;
    name: string;
    symbol: string;
    decimals: bigint;
    ownerSecretKey: Uint8Array;
    ownerAccount: Account;
    coinPK: CoinPublicKey;
  }): NativeShieldedTokenSimulator {
    return new NativeShieldedTokenSimulator(
      createPrivateState(args.ownerSecretKey),
      args.domainSep,
      args.name,
      args.symbol,
      args.decimals,
      args.ownerAccount,
      args.coinPK
    );
  }

  createPrivateState(name: string, secretKey: Uint8Array): void {
    this.userPrivateStates[name] = createPrivateState(secretKey);
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (ps: NativeShieldedTokenPrivateState): void => {
      this.userPrivateStates[name] = ps;
    };

  /** Switches the acting caller; identity is the secret key in private state. */
  as(name: string): NativeShieldedTokenSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for user '${name}'. Did you register it?`
      );
    }
    this.circuitContext = { ...this.circuitContext, currentPrivateState: ps };
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  /** Threads the new context back, and the caller's private state with it. */
  private commit<T>(res: {
    context: CircuitContext<NativeShieldedTokenPrivateState>;
    result: T;
  }): T {
    this.circuitContext = res.context;
    this.updateUserPrivateState(res.context.currentPrivateState);
    return res.result;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** Owner-only in our host. Returns the freshly minted coin. */
  public mint(
    recipient: CoinRecipient,
    amount: bigint,
    nonce: Uint8Array
  ): ShieldedCoinInfo {
    const res = this.contract.impureCircuits.mint(
      this.circuitContext,
      recipient,
      amount,
      nonce
    );
    logger.info({ section: "mint", gasCost: res.gasCost });
    return this.commit(res);
  }

  /** Owner-only. Returns the change coin, if any. */
  public burn(coin: ShieldedCoinInfo, amount: bigint, refundTo: CoinRecipient) {
    const res = this.contract.impureCircuits.burn(
      this.circuitContext,
      coin,
      amount,
      refundTo
    );
    return this.commit(res);
  }

  /**
   * Owner-only. Burns from a coin the contract already holds.
   *
   * NOTE: the module states the consumer SHOULD persist the returned change
   * coin, because it replaces the contract's holding and is not otherwise
   * recoverable. This contract has no circuit for receiving or holding a coin,
   * so the path is unreachable here and nothing is persisted. See docs.md.
   */
  public burnFromSelf(coin: QualifiedShieldedCoinInfo, amount: bigint) {
    const res = this.contract.impureCircuits.burnFromSelf(
      this.circuitContext,
      coin,
      amount
    );
    return this.commit(res);
  }

  public tokenColor(): Uint8Array {
    return this.commit(
      this.contract.impureCircuits.tokenColor(this.circuitContext)
    );
  }

  public name(): string {
    return this.commit(this.contract.impureCircuits.name(this.circuitContext));
  }

  public symbol(): string {
    return this.commit(
      this.contract.impureCircuits.symbol(this.circuitContext)
    );
  }

  public decimals(): bigint {
    return this.commit(
      this.contract.impureCircuits.decimals(this.circuitContext)
    );
  }

  public owner(): Account {
    return this.commit(this.contract.impureCircuits.owner(this.circuitContext));
  }

  /** Owner-only, enforced inside the OpenZeppelin module rather than the host. */
  public transferOwnership(newOwner: Account): Ledger {
    this.commit(
      this.contract.impureCircuits.transferOwnership(
        this.circuitContext,
        newOwner
      )
    );
    return this.getLedger();
  }

  /** Owner-only, enforced in the module. Permanently disables minting. */
  public renounceOwnership(): Ledger {
    this.commit(
      this.contract.impureCircuits.renounceOwnership(this.circuitContext)
    );
    return this.getLedger();
  }

  /**
   * Promotes a freshly minted coin to a spendable "qualified" coin. In a real
   * transaction `mt_index` comes from the ledger's coin commitment tree; here
   * it is set directly, exactly as `shielded-token-contract` does.
   */
  static qualify(
    coin: ShieldedCoinInfo,
    mtIndex: bigint = 0n
  ): QualifiedShieldedCoinInfo {
    return {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: mtIndex
    };
  }
}
