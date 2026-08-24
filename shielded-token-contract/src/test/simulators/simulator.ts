import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { deployer } from "../shielded-token.test.js";

import {
  Contract,
  type ShieldedCoinInfo,
  type QualifiedShieldedCoinInfo,
  type ShieldedSendResult
} from "../../managed/shielded-token/contract/index.js";
import {
  type ShieldedTokenPrivateState,
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

export type CoinPublicKey = { bytes: Uint8Array };

// This contract has no ledger state, so the simulator just executes circuits
// and returns their results. It keeps the constructor/context plumbing
// consistent with the other contracts in this repo.
export class ShieldedTokenSimulator {
  readonly contract: Contract<ShieldedTokenPrivateState>;
  circuitContext: CircuitContext<ShieldedTokenPrivateState>;
  contractAddress: ContractAddress;

  constructor(privateState: ShieldedTokenPrivateState) {
    this.contract = new Contract<ShieldedTokenPrivateState>(witnesses);
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

  static deploy(value: number = 0): ShieldedTokenSimulator {
    return new ShieldedTokenSimulator(createPrivateState(value));
  }

  // Mint a fresh shielded coin owned by this contract.
  mintShieldedToSelf(
    domainSep: Uint8Array,
    value: bigint,
    nonce: Uint8Array
  ): ShieldedCoinInfo {
    const res = this.contract.impureCircuits.mintShieldedToSelf(
      this.circuitContext,
      domainSep,
      value,
      nonce
    );
    this.circuitContext = res.context;
    logger.info({ section: "mintShieldedToSelf", gasCost: res.gasCost });
    return res.result;
  }

  // Receive (claim) an incoming shielded coin.
  receiveShieldedTokens(coin: ShieldedCoinInfo): void {
    const res = this.contract.impureCircuits.receiveShieldedTokens(
      this.circuitContext,
      coin
    );
    this.circuitContext = res.context;
    logger.info({ section: "receiveShieldedTokens", gasCost: res.gasCost });
  }

  // Send a qualified shielded coin to a user, returning what was sent + change.
  sendShieldedToUser(
    input: QualifiedShieldedCoinInfo,
    publicKey: CoinPublicKey,
    value: bigint
  ): ShieldedSendResult {
    const res = this.contract.impureCircuits.sendShieldedToUser(
      this.circuitContext,
      input,
      publicKey,
      value
    );
    this.circuitContext = res.context;
    logger.info({ section: "sendShieldedToUser", gasCost: res.gasCost });
    return res.result;
  }

  // Mint a fresh coin and immediately send it to a user.
  mintAndSendShielded(
    domainSep: Uint8Array,
    mintValue: bigint,
    mintNonce: Uint8Array,
    publicKey: CoinPublicKey,
    sendValue: bigint
  ): ShieldedSendResult {
    const res = this.contract.impureCircuits.mintAndSendShielded(
      this.circuitContext,
      domainSep,
      mintValue,
      mintNonce,
      publicKey,
      sendValue
    );
    this.circuitContext = res.context;
    logger.info({ section: "mintAndSendShielded", gasCost: res.gasCost });
    return res.result;
  }

  // Promote a freshly minted coin to a "qualified" coin (with a Merkle index)
  // so it can be spent. NOTE: in a real transaction the mt_index comes from the
  // ledger's coin commitment tree; here we set it directly. See docs.md.
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
