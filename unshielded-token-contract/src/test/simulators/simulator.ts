import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { deployer } from "../token.test.js";

import {
  Contract,
  type Ledger,
  ledger
} from "../../managed/unshielded-token/contract/index.js";
import {
  type TokenPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

export type UserAddress = { bytes: Uint8Array };

// This contract has no ledger state: it is a library of unshielded-token
// circuits. The simulator executes a circuit and returns its result, keeping
// the constructor/context plumbing consistent with the other contracts here.
export class TokenSimulator {
  readonly contract: Contract<TokenPrivateState>;
  circuitContext: CircuitContext<TokenPrivateState>;
  contractAddress: ContractAddress;

  constructor(privateState: TokenPrivateState) {
    this.contract = new Contract<TokenPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(privateState, deployer)
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
  }

  static deploy(value: number = 0): TokenSimulator {
    return new TokenSimulator(createPrivateState(value));
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  // Mint the contract's custom token to itself; returns the token color.
  mintAndReceive(amount: bigint): Uint8Array {
    const res = this.contract.impureCircuits.mintAndReceive(
      this.circuitContext,
      amount
    );
    this.circuitContext = res.context;
    logger.info({ section: "mintAndReceive", gasCost: res.gasCost });
    return res.result;
  }

  sendToUser(amount: bigint, userAddr: UserAddress): void {
    const res = this.contract.impureCircuits.sendToUser(
      this.circuitContext,
      amount,
      userAddr
    );
    this.circuitContext = res.context;
    logger.info({ section: "sendToUser", gasCost: res.gasCost });
  }

  receiveTokens(amount: bigint): void {
    const res = this.contract.impureCircuits.receiveTokens(
      this.circuitContext,
      amount
    );
    this.circuitContext = res.context;
    logger.info({ section: "receiveTokens", gasCost: res.gasCost });
  }

  receiveNightTokens(amount: bigint): void {
    const res = this.contract.impureCircuits.receiveNightTokens(
      this.circuitContext,
      amount
    );
    this.circuitContext = res.context;
    logger.info({ section: "receiveNightTokens", gasCost: res.gasCost });
  }

  sendNightTokensToUser(amount: bigint, userAddr: UserAddress): void {
    const res = this.contract.impureCircuits.sendNightTokensToUser(
      this.circuitContext,
      amount,
      userAddr
    );
    this.circuitContext = res.context;
    logger.info({ section: "sendNightTokensToUser", gasCost: res.gasCost });
  }
}
