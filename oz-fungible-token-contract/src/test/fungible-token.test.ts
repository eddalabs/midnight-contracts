import { describe, expect, it, beforeEach } from "vitest";
import { FungibleTokenSimulator } from "./simulators/simulator.js";
import { makeUser, asContract, randomBytes } from "./utils/utils.js";

// Identity in these modules is derived from a secret key, not a signature.
// Each user is a secret key plus the account id it hashes to.
const OWNER = makeUser("OWNER");
const ALICE = makeUser("ALICE");
const BOB = makeUser("BOB");

const NAME = "Edda Token";
const SYMBOL = "EDDA";
const DECIMALS = 18n;

// The Zswap coin public key of whoever submits the transaction. It is separate
// from the module-level identity above and is not what the guards check.
const coinPK = Buffer.from(randomBytes(32)).toString("hex");

const deploy = () =>
  FungibleTokenSimulator.deploy({
    name: NAME,
    symbol: SYMBOL,
    decimals: DECIMALS,
    ownerSecretKey: OWNER.secretKey,
    ownerAccount: OWNER.either,
    coinPK
  });

let token: FungibleTokenSimulator;

beforeEach(() => {
  token = deploy();
  token.createPrivateState("owner", OWNER.secretKey);
  token.createPrivateState("alice", ALICE.secretKey);
  token.createPrivateState("bob", BOB.secretKey);
});

describe("deployment", () => {
  it("records the initial owner and starts unpaused and empty", () => {
    const ledger = token.getLedger();

    expect(ledger.Ownable__owner.is_left).toBe(true);
    expect(ledger.Ownable__owner.left).toEqual(OWNER.accountId);
    expect(ledger.Pausable__isPaused).toBe(false);
    expect(ledger.FungibleToken__totalSupply).toBe(0n);
  });
});

describe("mint (owner only)", () => {
  it("lets the owner mint and moves total supply", () => {
    const ledger = token.as("owner").mint(ALICE.either, 1_000n);

    expect(ledger.FungibleToken__totalSupply).toBe(1_000n);
    expect(token.as("owner").balanceOf(ALICE.either)).toBe(1_000n);
  });

  it("rejects a non-owner", () => {
    // The guard this contract adds. FungibleToken__mint is ungated upstream,
    // so without Ownable_assertOnlyOwner anyone could mint.
    expect(() => token.as("alice").mint(ALICE.either, 1_000n)).toThrow(
      /not the owner/i
    );
  });

  it("rejects a contract address recipient", () => {
    // Contract-to-contract calls are not supported yet, so tokens sent to a
    // contract would be stranded. The module guards against it.
    const contractRecipient = asContract(randomBytes(32));

    expect(() => token.as("owner").mint(contractRecipient, 1n)).toThrow(
      /unsafe transfer/i
    );
  });
});

describe("transfer", () => {
  beforeEach(() => {
    token.as("owner").mint(ALICE.either, 1_000n);
  });

  it("moves balances between accounts", () => {
    token.as("alice").transfer(BOB.either, 400n);

    expect(token.as("owner").balanceOf(ALICE.either)).toBe(600n);
    expect(token.as("owner").balanceOf(BOB.either)).toBe(400n);
  });

  it("leaves total supply untouched", () => {
    const before = token.as("owner").totalSupply();
    token.as("alice").transfer(BOB.either, 400n);

    // Nothing is created or destroyed: transfer only moves Map entries.
    expect(token.as("owner").totalSupply()).toBe(before);
  });

  it("rejects transferring more than the balance", () => {
    // Match the message, not just any throw: the line after the module's
    // `assert(fromBal >= value)` underflows a Uint<128> and panics on its own,
    // so a bare toThrow() would stay green even with that assert deleted.
    expect(() => token.as("alice").transfer(BOB.either, 1_001n)).toThrow(
      /insufficient balance/i
    );
  });
});

describe("pause (owner only)", () => {
  beforeEach(() => {
    token.as("owner").mint(ALICE.either, 1_000n);
  });

  it("blocks transfers while paused and allows them again after unpause", () => {
    token.as("owner").pause();
    expect(token.as("owner").isPaused()).toBe(true);
    expect(() => token.as("alice").transfer(BOB.either, 1n)).toThrow(/paused/i);

    token.as("owner").unpause();
    expect(token.as("owner").isPaused()).toBe(false);

    token.as("alice").transfer(BOB.either, 1n);
    expect(token.as("owner").balanceOf(BOB.either)).toBe(1n);
  });

  it("rejects a non-owner pausing", () => {
    expect(() => token.as("alice").pause()).toThrow(/not the owner/i);
  });

  it("still allows the owner to mint while paused", () => {
    // Only circuits that call assertNotPaused are affected. Our host applies
    // the pause guard to value movement, not to supply control.
    token.as("owner").pause();

    const ledger = token.as("owner").mint(BOB.either, 5n);
    expect(ledger.FungibleToken__totalSupply).toBe(1_005n);
  });
});

describe("burn (owner only)", () => {
  beforeEach(() => {
    token.as("owner").mint(ALICE.either, 1_000n);
  });

  it("destroys supply and reduces the holder's balance", () => {
    const ledger = token.as("owner").burn(ALICE.either, 400n);

    expect(ledger.FungibleToken__totalSupply).toBe(600n);
    expect(token.as("owner").balanceOf(ALICE.either)).toBe(600n);
  });

  it("lets the owner burn a balance they do not hold", () => {
    // Worth pinning explicitly, because it is a confiscation power and it is
    // easy to miss: the module checks only that the target HAS the funds, not
    // that the caller owns them. Alice loses her balance without consenting.
    token.as("owner").burn(ALICE.either, 1_000n);

    expect(token.as("owner").balanceOf(ALICE.either)).toBe(0n);
  });

  it("rejects a non-owner", () => {
    expect(() => token.as("alice").burn(ALICE.either, 1n)).toThrow(
      /not the owner/i
    );
  });

  it("still works while paused, like mint", () => {
    token.as("owner").pause();

    const ledger = token.as("owner").burn(ALICE.either, 100n);
    expect(ledger.FungibleToken__totalSupply).toBe(900n);
  });
});

describe("allowances", () => {
  beforeEach(() => {
    token.as("owner").mint(ALICE.either, 1_000n);
  });

  it("lets a spender move someone else's balance once approved", () => {
    token.as("alice").approve(BOB.either, 300n);
    expect(token.as("owner").allowance(ALICE.either, BOB.either)).toBe(300n);

    token.as("bob").transferFrom(ALICE.either, BOB.either, 300n);

    expect(token.as("owner").balanceOf(ALICE.either)).toBe(700n);
    expect(token.as("owner").balanceOf(BOB.either)).toBe(300n);
    expect(token.as("owner").allowance(ALICE.either, BOB.either)).toBe(0n);
  });

  it("rejects spending more than the allowance", () => {
    token.as("alice").approve(BOB.either, 100n);

    expect(() =>
      token.as("bob").transferFrom(ALICE.either, BOB.either, 101n)
    ).toThrow(/insufficient allowance/i);
  });

  it("blocks approve and transferFrom while paused", () => {
    token.as("alice").approve(BOB.either, 100n);
    token.as("owner").pause();

    expect(() => token.as("alice").approve(BOB.either, 50n)).toThrow(/paused/i);
    expect(() =>
      token.as("bob").transferFrom(ALICE.either, BOB.either, 50n)
    ).toThrow(/paused/i);
  });
});

describe("ownership guards enforced inside the module", () => {
  it("rejects a non-owner transferring ownership", () => {
    // The one guard this contract does not apply itself: it lives two module
    // circuits deep inside Ownable, which makes it the most worth testing.
    expect(() => token.as("alice").transferOwnership(ALICE.either)).toThrow(
      /not the owner/i
    );
  });

  it("rejects a non-owner renouncing ownership", () => {
    expect(() => token.as("alice").renounceOwnership()).toThrow(
      /not the owner/i
    );
  });

  it("permanently disables minting once ownership is renounced", () => {
    token.as("owner").renounceOwnership();

    expect(() => token.as("owner").mint(BOB.either, 1n)).toThrow();
  });
});

describe("ownership transfer", () => {
  it("hands the owner powers to the new owner and revokes the old", () => {
    token.as("owner").transferOwnership(ALICE.either);

    expect(token.getLedger().Ownable__owner.left).toEqual(ALICE.accountId);

    token.as("alice").mint(BOB.either, 10n);
    expect(token.as("alice").balanceOf(BOB.either)).toBe(10n);

    expect(() => token.as("owner").mint(BOB.either, 10n)).toThrow(
      /not the owner/i
    );
  });
});
