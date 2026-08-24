import { describe, expect, it, beforeEach } from "vitest";
import { NativeShieldedTokenSimulator } from "./simulators/simulator.js";
import {
  makeUser,
  asCoinKey,
  coinPublicKey,
  randomBytes,
  toHexPadded
} from "./utils/utils.js";

const OWNER = makeUser("OWNER");
const ALICE = makeUser("ALICE");

const NAME = "Edda Shielded";
const SYMBOL = "sEDDA";
const DECIMALS = 18n;

// The domain separator is sealed at construction and, together with the
// contract address, determines the coin colour this contract can mint.
const domainSep = () =>
  Uint8Array.from(Buffer.from(toHexPadded("edda:native"), "hex"));

const coinPK = Buffer.from(randomBytes(32)).toString("hex");
const aliceCoinKey = asCoinKey(coinPublicKey("alice"));

const deploy = () =>
  NativeShieldedTokenSimulator.deploy({
    domainSep: domainSep(),
    name: NAME,
    symbol: SYMBOL,
    decimals: DECIMALS,
    ownerSecretKey: OWNER.secretKey,
    ownerAccount: OWNER.either,
    coinPK
  });

let token: NativeShieldedTokenSimulator;

beforeEach(() => {
  token = deploy();
  token.createPrivateState("owner", OWNER.secretKey);
  token.createPrivateState("alice", ALICE.secretKey);
});

describe("deployment", () => {
  it("exposes the metadata given at construction, and records the owner", () => {
    expect(token.name()).toBe(NAME);
    expect(token.symbol()).toBe(SYMBOL);
    expect(token.decimals()).toBe(DECIMALS);
    expect(token.getLedger().Ownable__owner.left).toEqual(OWNER.accountId);
  });

  it("keeps no balance state at all", () => {
    // The whole paradigm difference in one assertion: unlike the balance-Map
    // token, this contract's ledger holds only a domain and an owner. Coins
    // live in wallets, not here.
    const ledger = token.getLedger();

    expect(Object.keys(ledger).sort()).toEqual([
      "NativeShieldedToken__domain",
      "Ownable__owner"
    ]);
  });

  it("stores the domain separator given at construction", () => {
    expect(token.getLedger().NativeShieldedToken__domain).toEqual(domainSep());
  });
});

describe("mint (owner only)", () => {
  it("mints a real coin carrying the requested value and nonce", () => {
    const nonce = randomBytes(32);
    const coin = token.as("owner").mint(aliceCoinKey, 1_000n, nonce);

    // value and nonce are the real assertions here: they would catch an
    // argument-order bug. The colour is checked properly in the next test.
    expect(coin.value).toBe(1_000n);
    expect(coin.nonce).toEqual(nonce);
  });

  it("stamps every coin with this contract's token colour", () => {
    const color = token.as("owner").tokenColor();
    const coin = token.as("owner").mint(aliceCoinKey, 1n, randomBytes(32));

    // color = tokenType(_domain, kernel.self()), so only this contract can
    // mint coins of this colour.
    expect(coin.color).toEqual(color);
  });

  it("derives colour from the domain, not from the coin nonce", () => {
    const a = token.as("owner").mint(aliceCoinKey, 1n, randomBytes(32));
    const b = token.as("owner").mint(aliceCoinKey, 1n, randomBytes(32));

    expect(b.color).toEqual(a.color);
    expect(b.nonce).not.toEqual(a.nonce);
  });

  it("rejects a non-owner", () => {
    // The guard this contract adds. NativeShieldedToken__mint is ungated
    // upstream; the module's own docs say consumers SHOULD gate it.
    expect(() =>
      token.as("alice").mint(aliceCoinKey, 1_000n, randomBytes(32))
    ).toThrow(/not the owner/i);
  });
});

describe("burn (owner only)", () => {
  it("burns the whole coin, leaving no change", () => {
    // Limit worth naming: with no supply tracking there is no observable state
    // to check, so this pins the returned change only. The partial-burn test
    // below is the stronger one, because 700-500=200 is real arithmetic.
    const coin = token.as("owner").mint(aliceCoinKey, 700n, randomBytes(32));
    const change = token.as("owner").burn(coin, 700n, aliceCoinKey);

    expect(change.is_some).toBe(false);
  });

  it("burns part of a coin and returns the remainder", () => {
    const coin = token.as("owner").mint(aliceCoinKey, 700n, randomBytes(32));
    const change = token.as("owner").burn(coin, 500n, aliceCoinKey);

    expect(change.is_some).toBe(true);
    expect(change.value.value).toBe(200n);
  });

  it("rejects a non-owner", () => {
    const coin = token.as("owner").mint(aliceCoinKey, 10n, randomBytes(32));

    expect(() => token.as("alice").burn(coin, 10n, aliceCoinKey)).toThrow(
      /not the owner/i
    );
  });
});

describe("supply accounting", () => {
  it("tracks no totals, by design", () => {
    // Supply accounting is opt-in upstream via the PublicSupply extension,
    // which this contract deliberately does not compose. Assert the exhaustive
    // key set, not the absence of guessed names: composing the extension adds
    // `_totalMinted` / `_totalBurned`, so a test naming `_totalSupply` (a
    // computed circuit, never a ledger key) could never fail.
    token.as("owner").mint(aliceCoinKey, 1_000n, randomBytes(32));

    expect(Object.keys(token.getLedger()).sort()).toEqual([
      "NativeShieldedToken__domain",
      "Ownable__owner"
    ]);
  });
});

describe("burnFromSelf", () => {
  it("is owner-gated", () => {
    const coin = token.as("owner").mint(aliceCoinKey, 100n, randomBytes(32));
    const qualified = NativeShieldedTokenSimulator.qualify(coin);

    expect(() => token.as("alice").burnFromSelf(qualified, 100n)).toThrow(
      /not the owner/i
    );
  });
});

describe("ownership guards enforced inside the module", () => {
  it("rejects a non-owner transferring ownership", () => {
    // The one guard in this contract that is not visible in its own source:
    // it lives two module circuits deep inside Ownable.
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

    // No secret key can satisfy the zero owner, so the token is frozen for good.
    expect(() =>
      token.as("owner").mint(aliceCoinKey, 1n, randomBytes(32))
    ).toThrow();
  });
});

describe("ownership transfer", () => {
  it("moves minting rights to the new owner", () => {
    token.as("owner").transferOwnership(ALICE.either);

    expect(token.getLedger().Ownable__owner.left).toEqual(ALICE.accountId);

    token.as("alice").mint(aliceCoinKey, 5n, randomBytes(32));

    expect(() =>
      token.as("owner").mint(aliceCoinKey, 5n, randomBytes(32))
    ).toThrow(/not the owner/i);
  });
});
