import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { player1 } from "../minting.test.js";

import {
  Contract,
  type Ledger,
  ledger,
  ShieldedCoinInfo
} from "../../managed/minting-zswap/contract/index.js";
import {
  type MintingPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  CircuitResults,
  CoinPublicKey,
  emptyZswapLocalState,
  ContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { randomSk } from "../utils/utils.js";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

export class MintingSimulator {
  readonly contract: Contract<MintingPrivateState>;
  circuitContext: CircuitContext<MintingPrivateState>;
  userPrivateStates: Record<string, MintingPrivateState>;
  updateUserPrivateState: (newPrivateState: MintingPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(privateState: MintingPrivateState) {
    this.contract = new Contract<MintingPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext({ privateMinting: privateState.privateMinting }, player1),
      randomSk()
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
    this.userPrivateStates = { ["p1"]: currentPrivateState };
    this.updateUserPrivateState = (newPrivateState: MintingPrivateState) => {};
  }

  static deployContract(value: number): MintingSimulator {
    return new MintingSimulator(createPrivateState(value));
  }

  createPrivateState(pName: string, value: number): void {
    this.userPrivateStates[pName] = createPrivateState(value);
  }

  private buildTurnContext(
    currentPrivateState: MintingPrivateState
  ): CircuitContext<MintingPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState
    };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: MintingPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  as(name: string): MintingSimulator {
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

  public getPrivateState(): MintingPrivateState {
    return this.circuitContext.currentPrivateState;
  }

    public getCircuitContext(): CircuitContext<MintingPrivateState> {
    return this.circuitContext;
  }

  updateStateAndGetLedger<T>(
    circuitResults: CircuitResults<MintingPrivateState, T>
  ): Ledger {
    this.circuitContext = circuitResults.context;
    this.updateUserPrivateState(circuitResults.context.currentPrivateState);
    return this.getLedger();
  }

  public mint(coin: ShieldedCoinInfo, sender?: CoinPublicKey): Ledger {
    // Update the current context to be the result of executing the circuit.
    const circuitResults = this.contract.impureCircuits.mint(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState
      },
      coin
    );
      logger.info("MINTING");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      proofData: circuitResults.proofData,
      result: circuitResults.result
    });
    return this.updateStateAndGetLedger(circuitResults);
  }

  public burn(value: bigint, sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.burn(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState
      },
      value
    );
      logger.info("BURNING");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      proofData: circuitResults.proofData,
      result: circuitResults.result
    });
    return this.updateStateAndGetLedger(circuitResults);
  }

  public owner_withdraw(value: bigint, sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.owner_withdraw(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState
      },
      value
    );
      logger.info("WITHDRAWING");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      proofData: circuitResults.proofData,
      result: circuitResults.result
    });
    return this.updateStateAndGetLedger(circuitResults);
  }
}
