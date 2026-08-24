// Adapted from the CounterSimulator pattern in this repo, which is itself
// adapted from midnightntwrk/example-counter (Apache-2.0). See docs.md § 10.

import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";

import {
  Contract,
  type Ledger,
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
  type ContractAddress,
  type ShieldedCoinInfo,
  type QualifiedShieldedCoinInfo
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

  /** Switches the acting caller; identity is the secret key in private state. */
  as(name: string): NativeShieldedTokenSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for user '${name}'. Did you register it?`
      );
    }
    this.circuitContext = { ...this.circuitContext, currentPrivateState: ps };
    return this;
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
    this.circuitContext = res.context;
    logger.info({ section: "mint", gasCost: res.gasCost });
    return res.result;
  }

  /** Owner-only. Returns the change coin, if any. */
  public burn(
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: CoinRecipient
  ) {
    const res = this.contract.impureCircuits.burn(
      this.circuitContext,
      coin,
      amount,
      refundTo
    );
    this.circuitContext = res.context;
    return res.result;
  }

  public tokenColor(): Uint8Array {
    const res = this.contract.impureCircuits.tokenColor(this.circuitContext);
    this.circuitContext = res.context;
    return res.result;
  }

  public name(): string {
    return this.contract.impureCircuits.name(this.circuitContext).result;
  }

  public symbol(): string {
    return this.contract.impureCircuits.symbol(this.circuitContext).result;
  }

  public decimals(): bigint {
    return this.contract.impureCircuits.decimals(this.circuitContext).result;
  }

  public transferOwnership(newOwner: Account): Ledger {
    const res = this.contract.impureCircuits.transferOwnership(
      this.circuitContext,
      newOwner
    );
    this.circuitContext = res.context;
    return this.getLedger();
  }

  /**
   * Promotes a freshly minted coin to a spendable "qualified" coin. In a real
   * transaction `mt_index` comes from the ledger's coin commitment tree; here
   * we set it directly, exactly as `shielded-token-contract` does.
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
