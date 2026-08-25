# Shielded Token

The private sibling of the [unshielded token](../unshielded-token-contract/docs.md).
Where that contract moved **unshielded** tokens (amounts and owners visible to
everyone), this one moves **shielded** tokens (Zswap coins), where the value,
type, and owner are hidden on-chain behind a cryptographic commitment. It is the
token analogue of the [bulletin board's](../bulletin-board-contract/docs.md)
privacy: prove a coin moved correctly without revealing what moved.

The four circuits here are ported **verbatim** from Midnight's official
token-transfers contract, which lives at
[`midnightntwrk/midnight-wallet-dapp`](https://github.com/midnightntwrk/midnight-wallet-dapp)
(`src/contract/contracts/token-transfers.compact`) and is rendered in the
[docs](https://docs.midnight.network/examples/contracts/token-transfers).
The circuit logic is unchanged. The only additions, neither of which is contract
logic: a `pragma` line (a version pin, kept for consistency with this repo; the
upstream has none and compiles either way) and a `export { ... }` of the coin
types (so the TypeScript tests can import them by name). This is a faithful
runnable copy of the official reference, not a reinterpretation.

> **Analogy.** An unshielded token is a poker chip on the open counter: anyone
> watching sees its color and that it slid from you to me. A shielded coin is
> cash sealed in an opaque envelope. The ledger only ever holds a tamper-proof
> *receipt* that "an envelope exists" (a commitment), never the amount inside.
> To spend it you drop a one-time "void" stamp (a nullifier) that proves you
> owned a real envelope and are spending it once, without revealing which one.
> That is the exact commitment/nullifier machinery from the bulletin board,
> now applied to money.

---

## 1. What this contract does

It is a small library of the four core shielded-coin operations. It holds **no
ledger state of its own**; each circuit takes coins in or hands coins back as
return values.

| Circuit | What it does |
|---------|--------------|
| `mintShieldedToSelf(domainSep, value, nonce)` | mint a fresh shielded coin owned by this contract, returns the `ShieldedCoinInfo` |
| `receiveShieldedTokens(coin)` | claim an incoming shielded coin |
| `sendShieldedToUser(input, publicKey, value)` | send a coin to a user, returning what was `sent` plus any `change` |
| `mintAndSendShielded(...)` | mint a coin and immediately send it, in one circuit |

The interesting return type is `ShieldedSendResult`, which carries both the
`sent` coin and the `change` coin. That is UTXO change-making: you spend a whole
coin and get the remainder back as a new coin, exactly like breaking a $20 bill.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd shielded-token-contract
npm run compact      # compile shielded-token.compact into src/managed/shielded-token/
npm test             # run the Vitest suite
```

No node, wallet, or proof server. The suite runs in memory.

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation
> (`--skip-zk`) for faster iteration.

---

## 3. The contract, line by line

`src/shielded-token.compact` (verbatim circuits; comments trimmed):

```compact
pragma language_version >= 0.23;
import CompactStandardLibrary;

export { ShieldedCoinInfo, QualifiedShieldedCoinInfo, ShieldedSendResult };

export circuit receiveShieldedTokens(coin: ShieldedCoinInfo): [] {
   receiveShielded(disclose(coin));
}

export circuit sendShieldedToUser(input: QualifiedShieldedCoinInfo,
    publicKey: ZswapCoinPublicKey, value: Uint<128>): ShieldedSendResult {
  return sendShielded(disclose(input),
    left<ZswapCoinPublicKey, ContractAddress>(disclose(publicKey)), disclose(value));
}

export circuit mintShieldedToSelf(domainSep: Bytes<32>, value: Uint<64>,
    nonce: Bytes<32>): ShieldedCoinInfo {
  return mintShieldedToken(disclose(domainSep), disclose(value),
    disclose(nonce), right<ZswapCoinPublicKey, ContractAddress>(kernel.self()));
}

export circuit mintAndSendShielded(domainSep: Bytes<32>, mintValue: Uint<64>,
    mintNonce: Bytes<32>, publicKey: ZswapCoinPublicKey,
    sendValue: Uint<128>): ShieldedSendResult {
  const coin = mintShieldedToken(disclose(domainSep), disclose(mintValue),
    disclose(mintNonce), right<ZswapCoinPublicKey, ContractAddress>(kernel.self()));
  const qualified = QualifiedShieldedCoinInfo { nonce: coin.nonce,
    color: coin.color, value: coin.value, mt_index: 0 as Uint<64> };
  return sendShielded(qualified, left<ZswapCoinPublicKey, ContractAddress>(disclose(publicKey)),
    disclose(sendValue));
}
```

The shielded vocabulary, all from `CompactStandardLibrary`:

**A shielded coin is data: `ShieldedCoinInfo { nonce, color, value }`.** A coin
is not a row in some ledger balance. It is a value you hold: a `nonce` (makes it
unique), a `color` (its token type), and a `value`. On-chain, only a commitment
to this data sits in a Merkle tree, so the amount and owner stay hidden.

This is the opposite of the account model, where a token is a number in a table
keyed by your address. Here there is no table and no address: a coin is an
object you hold, and the chain sees only its commitment. For the account model
side by side with this one, see
[`oz-fungible-token-contract`](../oz-fungible-token-contract/docs.md).

**`mintShieldedToken(domainSep, value, nonce, recipient)`** creates a coin of a
given `value`. The token's `color` is derived from `domainSep` plus the minter,
so the same tag always yields the same color. The recipient is an
`Either<ZswapCoinPublicKey, ContractAddress>`. Note the order: here
`right(...)` is the contract (`kernel.self()`), and in `sendShieldedToUser`
`left(...)` is the user. That order is the **reverse** of the unshielded
contract's `Either<ContractAddress, UserAddress>`, so always read the type
parameters rather than memorizing left/right.

**`receiveShielded(coin)`** claims an incoming coin. As in Part 1, a coin is
just loose data until a contract explicitly receives it.

**`sendShielded(input, recipient, value)`** spends a coin. It takes a
`QualifiedShieldedCoinInfo` (a coin plus its `mt_index`, see
[§4](#4-the-mt_index-subtlety)) and returns a `ShieldedSendResult` with the
`sent` coin and any `change`.

**`disclose(...)` everywhere.** Every coin, key, and amount flowing into a
shielded operation is wrapped, because feeding private values into a
publicly-verifiable operation is a deliberate disclosure. The verbatim source
discloses uniformly; as the bulletin board showed, not every one of these is
strictly required by the compiler, but disclosing consistently is reasonable
style.

---

## 4. The `mt_index` subtlety

This is the detail worth slowing down on. It is the same phase-1 vs. phase-2
boundary the [unshielded sibling](../unshielded-token-contract/docs.md) hits,
in a sharper form.

To spend a shielded coin you need a `QualifiedShieldedCoinInfo`: the coin **plus
an `mt_index`**, its position in the ledger's coin-commitment Merkle tree. That
index is what lets a spend prove "this coin really exists and was committed."

Look at `mintAndSendShielded`: it mints a coin and immediately builds a
`QualifiedShieldedCoinInfo { ..., mt_index: 0 }` to send it. But a **freshly
minted coin has not been committed to the tree yet**, so it has no real index.
The example hardcodes `0`. In our in-memory simulator this runs fine, because
the simulator does not check Merkle membership. On a real chain it would not:
you must first let the coin be committed, then spend it with its actual index.
(Community write-ups call this out as a classic first stumble with shielded
coins.)

So, the honest layering:

| Layer | What it checks | Where |
|-------|----------------|-------|
| circuit logic, return values, change-making | the shielded API behaves | phase-1 (these tests) |
| coin is committed (valid `mt_index`), conservation, nullifier uniqueness | the coin truly exists and is spent once | phase-2 (node + proof server) |

Our tests assert what phase-1 can honestly verify: minted values, color
determinism, and that a partial send returns correct change. They do **not**
claim the Merkle proofs hold. That is the line, and pretending otherwise would
be the dishonesty this catalog avoids.

---

## 5. Shielded vs. unshielded (the pair)

Read this contract next to [`unshielded-token-contract`](../unshielded-token-contract/docs.md); they
are the same operations in the two privacy domains.

| | Unshielded (`token-contract`) | Shielded (this one) |
|---|---|---|
| mint | `mintUnshieldedToken` | `mintShieldedToken` |
| send | `sendUnshielded` | `sendShielded` |
| receive | `receiveUnshielded` | `receiveShielded` |
| a "coin" is | a public `(color, amount)` movement | a `ShieldedCoinInfo` with a hidden value |
| on-chain you see | amounts and addresses | only a commitment (a hash) |
| change-making | not modeled (plain counters) | explicit `ShieldedSendResult.change` |

NIGHT, the native token, is unshielded. Shielded coins are the privacy-first
path: use them when amounts or holders must stay confidential.

---

## 6. What the compiler generates

`npm run compact` writes `src/managed/shielded-token/` (generated; never commit).
The key types and circuits:

```ts
export type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
export type QualifiedShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint };
export type ShieldedSendResult = { change: { is_some: boolean; value: ShieldedCoinInfo }; sent: ShieldedCoinInfo };

export type ImpureCircuits<PS> = {
  receiveShieldedTokens(ctx, coin_0: ShieldedCoinInfo): CircuitResults<PS, []>;
  sendShieldedToUser(ctx, input_0: QualifiedShieldedCoinInfo, publicKey_0: { bytes: Uint8Array }, value_0: bigint): CircuitResults<PS, ShieldedSendResult>;
  mintShieldedToSelf(ctx, domainSep_0: Uint8Array, value_0: bigint, nonce_0: Uint8Array): CircuitResults<PS, ShieldedCoinInfo>;
  mintAndSendShielded(ctx, ...): CircuitResults<PS, ShieldedSendResult>;
}
```

Notice `Bytes<32>` becomes `Uint8Array`, `Uint<64>`/`Uint<128>` become `bigint`,
and `ZswapCoinPublicKey` becomes `{ bytes: Uint8Array }`. The `Ledger` type is
empty: this contract stores nothing on-chain, it only operates on coins.

---

## 7. The simulator

`src/test/simulators/simulator.ts` defines `ShieldedTokenSimulator`. Because
there is no ledger state, it is leaner than the others: it executes a circuit
and returns the circuit's result.

```ts
const sim = ShieldedTokenSimulator.deploy();
const coin = sim.mintShieldedToSelf(domainSep, 1000n, nonce);   // -> ShieldedCoinInfo
sim.receiveShieldedTokens(coin);
const result = sim.sendShieldedToUser(ShieldedTokenSimulator.qualify(coin), alice, 700n);
```

The helper `ShieldedTokenSimulator.qualify(coin, mtIndex = 0)` turns a
`ShieldedCoinInfo` into a `QualifiedShieldedCoinInfo` by attaching an
`mt_index`. As [§4](#4-the-mt_index-subtlety) explains, supplying `0` is a
test-only shortcut; a real spend uses the coin's actual tree index. The helper
exists precisely to make that shortcut visible rather than buried.

---

## 8. The tests

`src/test/shielded-token.test.ts` has six tests, asserting only what phase-1 can
honestly check:

```ts
it("mints a shielded coin with the given value, nonce, and a 32-byte color", () => {
  const coin = sim.mintShieldedToSelf(domainSep, 1000n, nonce);
  expect(coin.value).toEqual(1000n);
  expect(coin.nonce).toEqual(nonce);     // the nonce we asked for is echoed
  expect(coin.color.length).toEqual(32);
});

it("derives the color from the domain tag, independent of the nonce", () => {
  const a = sim.mintShieldedToSelf(domainSep, 1n, randomBytes(32));
  const b = sim.mintShieldedToSelf(domainSep, 1n, randomBytes(32));
  expect(b.color).toEqual(a.color);      // same tag => same color
  expect(b.nonce).not.toEqual(a.nonce);  // different coins
});

it("sends part of a coin and returns the remainder as change", () => {
  const coin = sim.mintShieldedToSelf(domainSep, 700n, randomBytes(32));
  const result = sim.sendShieldedToUser(ShieldedTokenSimulator.qualify(coin), alice, 500n);
  expect(result.sent.value).toEqual(500n);
  expect(result.change.is_some).toEqual(true);
  expect(result.change.value.value).toEqual(200n);   // 700 - 500 change
});
```

The rest cover receiving a coin, sending a full coin (no change), and
`mintAndSendShielded`. The change-making test is the most instructive: it shows
the UTXO model in action, splitting one coin into a sent coin plus a 200-unit
change coin.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each change.

1. **Watch change-making.** Mint a coin of `1000n`, then send `300n`. What are
   `result.sent.value` and `result.change.value.value`? Send `0n`: what happens
   to change?
2. **Probe the `mt_index` shortcut.** In a test, `qualify` a coin with
   `mt_index = 999n` instead of `0n` and send it. Does the simulator care? What
   does that tell you about which guarantees live in phase-2, not here?
3. **Color vs. nonce.** Mint two coins with *different* `domainSep` values and
   confirm their colors differ. Then mint two with the same `domainSep` and
   different nonces and confirm the colors match. Which field is the token
   *type*, and which makes each coin *unique*?
4. **Connect it to the bulletin board.** A shielded coin's on-chain footprint is
   a commitment, and spending it posts a nullifier. Re-read
   `compute_author_commitment` in
   [`bulletin-board-contract`](../bulletin-board-contract/docs.md): which
   mechanism there is this the same as, and why must a nullifier be unlinkable
   to its commitment?

---

## 10. Credits & references

- The four circuits are **verbatim** from Midnight's official token-transfers
  contract: [`midnightntwrk/midnight-wallet-dapp`](https://github.com/midnightntwrk/midnight-wallet-dapp)
  (`src/contract/contracts/token-transfers.compact`), also rendered in the
  [docs](https://docs.midnight.network/examples/contracts/token-transfers). There
  the contract is driven by a React wallet UI; what this workspace adds is the
  phase-1 simulator + Vitest harness so the circuits can be unit-tested in
  isolation. Token function signatures come from the
  [Compact standard library](https://docs.midnight.network/compact/standard-library/exports).
- The simulator and phase-1 testing pattern is adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter);
  its copyright notice is preserved in this workspace's `vitest.config.ts`.
- Background on shielded tokens and Zswap:
  <https://docs.midnight.network/concepts/zswap> and
  <https://docs.midnight.network/concepts/how-midnight-works/zswap>.
