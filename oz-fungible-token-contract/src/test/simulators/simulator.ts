// Adapted from the CounterSimulator pattern in this repo, which is itself
// adapted from midnightntwrk/example-counter (Apache-2.0). See docs.md § 10.

import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";

import {
  Contract,
  type Ledger,
  ledger
} from "../../managed/fungible-token/contract/index.js";
import {
  type FungibleTokenPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  type CircuitResults,
  type CoinPublicKey,
  emptyZswapLocalState,
  type ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

/** An `Either<Bytes<32>, ContractAddress>` as the generated bindings expect it. */
export type Recipient = {
  is_left: boolean;
  left: Uint8Array;
  right: { bytes: Uint8Array };
};

export class FungibleTokenSimulator {
  readonly contract: Contract<FungibleTokenPrivateState>;
  circuitContext: CircuitContext<FungibleTokenPrivateState>;
  userPrivateStates: Record<string, FungibleTokenPrivateState>;
  updateUserPrivateState: (newPrivateState: FungibleTokenPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(
    privateState: FungibleTokenPrivateState,
    name: string,
    symbol: string,
    decimals: bigint,
    initialOwner: Recipient,
    coinPK: CoinPublicKey
  ) {
    this.contract = new Contract<FungibleTokenPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(privateState, coinPK),
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

  /**
   * Deploys the token. `owner` is the account whose secret key will satisfy
   * `Ownable_assertOnlyOwner`, so the deployer's private state starts as theirs.
   */
  static deploy(args: {
    name: string;
    symbol: string;
    decimals: bigint;
    ownerSecretKey: Uint8Array;
    ownerAccount: Recipient;
    coinPK: CoinPublicKey;
  }): FungibleTokenSimulator {
    return new FungibleTokenSimulator(
      createPrivateState(args.ownerSecretKey),
      args.name,
      args.symbol,
      args.decimals,
      args.ownerAccount,
      args.coinPK
    );
  }

  /** Registers a named participant so `as(name)` can act on their behalf. */
  createPrivateState(name: string, secretKey: Uint8Array): void {
    this.userPrivateStates[name] = createPrivateState(secretKey);
  }

  private buildTurnContext(
    currentPrivateState: FungibleTokenPrivateState
  ): CircuitContext<FungibleTokenPrivateState> {
    return { ...this.circuitContext, currentPrivateState };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: FungibleTokenPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  /**
   * Switches the acting caller. Identity here is the secret key in private
   * state, not a signature: whoever supplies a key claims that account.
   */
  as(name: string): FungibleTokenSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for user '${name}'. Did you register it?`
      );
    }
    this.circuitContext = this.buildTurnContext(ps);
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): FungibleTokenPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public getCircuitContext(): CircuitContext<FungibleTokenPrivateState> {
    return this.circuitContext;
  }

  updateStateAndGetLedger<T>(
    circuitResults: CircuitResults<FungibleTokenPrivateState, T>
  ): Ledger {
    this.circuitContext = circuitResults.context;
    this.updateUserPrivateState(circuitResults.context.currentPrivateState);
    return this.getLedger();
  }

  private contextFor(sender?: CoinPublicKey) {
    return {
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState
    };
  }

  /** Owner-only. Guarded here by `Ownable_assertOnlyOwner`. */
  public mint(to: Recipient, value: bigint, sender?: CoinPublicKey): Ledger {
    const results = this.contract.impureCircuits.mint(
      this.contextFor(sender),
      to,
      value
    );
    logger.info({ section: "mint", gasCost: results.gasCost });
    return this.updateStateAndGetLedger(results);
  }

  /** Owner-only. */
  public burn(from: Recipient, value: bigint, sender?: CoinPublicKey): Ledger {
    const results = this.contract.impureCircuits.burn(
      this.contextFor(sender),
      from,
      value
    );
    return this.updateStateAndGetLedger(results);
  }

  /** Blocked while paused. */
  public transfer(
    to: Recipient,
    value: bigint,
    sender?: CoinPublicKey
  ): Ledger {
    const results = this.contract.impureCircuits.transfer(
      this.contextFor(sender),
      to,
      value
    );
    return this.updateStateAndGetLedger(results);
  }

  /** Blocked while paused. */
  public approve(
    spender: Recipient,
    value: bigint,
    sender?: CoinPublicKey
  ): Ledger {
    const results = this.contract.impureCircuits.approve(
      this.contextFor(sender),
      spender,
      value
    );
    return this.updateStateAndGetLedger(results);
  }

  /** Blocked while paused. */
  public transferFrom(
    from: Recipient,
    to: Recipient,
    value: bigint,
    sender?: CoinPublicKey
  ): Ledger {
    const results = this.contract.impureCircuits.transferFrom(
      this.contextFor(sender),
      from,
      to,
      value
    );
    return this.updateStateAndGetLedger(results);
  }

  /** Owner-only. */
  public pause(sender?: CoinPublicKey): Ledger {
    const results = this.contract.impureCircuits.pause(this.contextFor(sender));
    return this.updateStateAndGetLedger(results);
  }

  /** Owner-only. */
  public unpause(sender?: CoinPublicKey): Ledger {
    const results = this.contract.impureCircuits.unpause(
      this.contextFor(sender)
    );
    return this.updateStateAndGetLedger(results);
  }

  /** Owner-only, enforced inside the OpenZeppelin module itself. */
  public transferOwnership(
    newOwner: Recipient,
    sender?: CoinPublicKey
  ): Ledger {
    const results = this.contract.impureCircuits.transferOwnership(
      this.contextFor(sender),
      newOwner
    );
    return this.updateStateAndGetLedger(results);
  }

  public balanceOf(account: Recipient, sender?: CoinPublicKey): bigint {
    return this.contract.impureCircuits.balanceOf(
      this.contextFor(sender),
      account
    ).result;
  }

  public totalSupply(sender?: CoinPublicKey): bigint {
    return this.contract.impureCircuits.totalSupply(this.contextFor(sender))
      .result;
  }

  public allowance(
    owner_: Recipient,
    spender: Recipient,
    sender?: CoinPublicKey
  ): bigint {
    return this.contract.impureCircuits.allowance(
      this.contextFor(sender),
      owner_,
      spender
    ).result;
  }

  public owner(sender?: CoinPublicKey): Recipient {
    return this.contract.impureCircuits.owner(this.contextFor(sender)).result;
  }

  /** Owner-only, enforced in the module. Permanently disables minting. */
  public renounceOwnership(sender?: CoinPublicKey): Ledger {
    const results = this.contract.impureCircuits.renounceOwnership(
      this.contextFor(sender)
    );
    return this.updateStateAndGetLedger(results);
  }

  public isPaused(sender?: CoinPublicKey): boolean {
    return this.contract.impureCircuits.isPaused(this.contextFor(sender))
      .result;
  }
}
