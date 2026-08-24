import { ShieldedTokenSimulator, logger } from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";

// The caller that "deploys" the contract.
export const deployer = utils.toHexPadded("deployer");

const DOMAIN = utils.toHexPadded("edda:shielded"); // a 32-byte domain tag (hex)
const domainSep = () => Uint8Array.from(Buffer.from(DOMAIN, "hex"));
const alice = utils.coinPublicKey("alice");

describe("Shielded token circuits", () => {
  it("mints a shielded coin with the given value, nonce, and a 32-byte color", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const nonce = utils.randomBytes(32);
    const coin = sim.mintShieldedToSelf(domainSep(), 1000n, nonce);

    expect(coin.value).toEqual(1000n);
    expect(coin.nonce).toEqual(nonce); // the nonce we asked for is echoed back
    expect(coin.color).toBeInstanceOf(Uint8Array);
    expect(coin.color.length).toEqual(32);
  });

  it("derives the color from the domain tag, independent of the nonce", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const a = sim.mintShieldedToSelf(domainSep(), 1n, utils.randomBytes(32));
    const b = sim.mintShieldedToSelf(domainSep(), 1n, utils.randomBytes(32));
    // Same domain tag => same token color, even with different coin nonces.
    expect(b.color).toEqual(a.color);
    expect(b.nonce).not.toEqual(a.nonce);
  });

  it("receives an incoming shielded coin", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const coin = sim.mintShieldedToSelf(
      domainSep(),
      500n,
      utils.randomBytes(32)
    );
    expect(() => sim.receiveShieldedTokens(coin)).not.toThrow();
  });

  it("sends the full coin value, leaving no change", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const coin = sim.mintShieldedToSelf(
      domainSep(),
      700n,
      utils.randomBytes(32)
    );
    const qualified = ShieldedTokenSimulator.qualify(coin);
    const result = sim.sendShieldedToUser(qualified, alice, 700n);

    expect(result.sent.value).toEqual(700n);
    expect(result.change.is_some).toEqual(false);
  });

  it("sends part of a coin and returns the remainder as change", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const coin = sim.mintShieldedToSelf(
      domainSep(),
      700n,
      utils.randomBytes(32)
    );
    const qualified = ShieldedTokenSimulator.qualify(coin);
    const result = sim.sendShieldedToUser(qualified, alice, 500n);

    expect(result.sent.value).toEqual(500n);
    expect(result.change.is_some).toEqual(true);
    expect(result.change.value.value).toEqual(200n);

    logger.info({
      section: "send with change",
      sent: result.sent.value,
      change: result.change.value.value
    });
  });

  it("mints and sends in one circuit", () => {
    const sim = ShieldedTokenSimulator.deploy();
    const result = sim.mintAndSendShielded(
      domainSep(),
      900n,
      utils.randomBytes(32),
      alice,
      900n
    );
    expect(result.sent.value).toEqual(900n);
  });
});
