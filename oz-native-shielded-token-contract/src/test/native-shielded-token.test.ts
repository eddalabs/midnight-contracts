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
  it("seals the metadata and records the owner", () => {
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

  it("seals the domain separator given at construction", () => {
    expect(token.getLedger().NativeShieldedToken__domain).toEqual(domainSep());
  });
});

describe("mint (owner only)", () => {
  it("mints a real coin carrying the requested value and nonce", () => {
    const nonce = randomBytes(32);
    const coin = token.as("owner").mint(aliceCoinKey, 1_000n, nonce);

    expect(coin.value).toBe(1_000n);
    expect(coin.nonce).toEqual(nonce);
    expect(coin.color).toBeInstanceOf(Uint8Array);
    expect(coin.color.length).toBe(32);
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
    // The guard OUR contract adds. NativeShieldedToken__mint is ungated
    // upstream; the module's own docs say consumers SHOULD gate it.
    expect(() =>
      token.as("alice").mint(aliceCoinKey, 1_000n, randomBytes(32))
    ).toThrow(/not the owner/i);
  });
});

describe("burn (owner only)", () => {
  it("burns the whole coin, leaving no change", () => {
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
    // which this contract deliberately does not compose. Asserting the gap
    // so the docs' claim stays honest.
    token.as("owner").mint(aliceCoinKey, 1_000n, randomBytes(32));

    expect(token.getLedger()).not.toHaveProperty("_totalSupply");
    expect(token.getLedger()).not.toHaveProperty(
      "NativeShieldedToken__totalSupply"
    );
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
