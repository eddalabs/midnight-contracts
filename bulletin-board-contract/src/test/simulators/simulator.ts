import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { user1 } from "../bulletin-board.test.js";

import { Contract, type Ledger, ledger } from "../../managed/bulletin-board/contract/index.js";
import { type BulletinBoardPrivateState, createPrivateState, witnesses } from "../../witnesses.js";

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

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

export class BulletinBoardSimulator {
  readonly contract: Contract<BulletinBoardPrivateState>;
  circuitContext: CircuitContext<BulletinBoardPrivateState>;
  userPrivateStates: Record<string, BulletinBoardPrivateState>;
  updateUserPrivateState: (newPrivateState: BulletinBoardPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(privateState: BulletinBoardPrivateState) {
    this.contract = new Contract<BulletinBoardPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext({ secretKey: privateState.secretKey }, user1),
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(currentContractState.data, this.contractAddress),
      costModel: CostModel.initialCostModel(),
    };
    this.userPrivateStates = { ["user1"]: currentPrivateState };
    this.updateUserPrivateState = () => {};
  }

  static deployContract(secretKey: Uint8Array): BulletinBoardSimulator {
    return new BulletinBoardSimulator(createPrivateState(secretKey));
  }

  createPrivateState(userName: string, secretKey: Uint8Array): void {
    this.userPrivateStates[userName] = createPrivateState(secretKey);
  }

  private buildTurnContext(
    currentPrivateState: BulletinBoardPrivateState,
  ): CircuitContext<BulletinBoardPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState,
    };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: BulletinBoardPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  as(name: string): BulletinBoardSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(`No private state found for user '${name}'. Did you register it?`);
    }
    this.circuitContext = this.buildTurnContext(ps);
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): BulletinBoardPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public getCircuitContext(): CircuitContext<BulletinBoardPrivateState> {
    return this.circuitContext;
  }

  updateStateAndGetLedger<T>(circuitResults: CircuitResults<BulletinBoardPrivateState, T>): Ledger {
    this.circuitContext = circuitResults.context;
    this.updateUserPrivateState(circuitResults.context.currentPrivateState);
    return this.getLedger();
  }

  public postNote(content: string, sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.postNote(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      content,
    );

    logger.info("POST NOTE CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result,
    });

    return this.updateStateAndGetLedger(circuitResults);
  }

  public takeDown(sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.takeDown({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    logger.info("TAKE DOWN CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result,
    });

    return this.updateStateAndGetLedger(circuitResults);
  }
}
