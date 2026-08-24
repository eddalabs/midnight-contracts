# OpenZeppelin Native Shielded Token

A token that mints **real coins**, assembled from OpenZeppelin modules.

This is the twin of
[`oz-fungible-token-contract`](../oz-fungible-token-contract/docs.md). Both are
called tokens, both are built from the same library, both use the same `Ownable`
guard. They are completely different machines, and holding the two side by side
is the point of having both.

Read the fungible token first if you have not: it explains what a module is,
how `prefix` works, and why OpenZeppelin ships every `_`-prefixed circuit
ungated (`transferOwnership` is a mutator that guards itself, so "every
mutator" would be wrong). This
document assumes all of that and spends its time on what makes a *coin*
different from a *balance*.

---

## 1. What this contract does

The owner can conjure coins out of nothing and hand them to someone. Coins can
later be destroyed.

```
owner calls mint(alice, 1000, nonce)
   -> a ShieldedCoinInfo { value: 1000, color: <this token>, nonce }
   -> lands in alice's wallet
   -> this contract's state does not change at all
```

That last line is the whole story. Compare with the balance-Map token, where a
mint writes a row into a table this contract owns. Here, the contract mints
something and then **forgets about it**. The coin is a real Zswap asset. It
lives in a wallet. This contract could not enumerate its holders if it wanted
to.

The coin's identity is its **colour**:

```
color = tokenType(_domain, kernel.self())
```

`_domain` is a 32-byte tag fixed when the contract is deployed, and
`kernel.self()` is this contract's address. Together they mean **only this
contract can ever mint coins of this colour**. The standard library puts the
reason precisely: a contract can issue tokens for its own domain separators,
but "due to collision resistance, it cannot mint tokens for another contract's
token type". The guarantee rests on the hardness of colliding the derivation,
not on anything about who may deploy where.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd oz-native-shielded-token-contract
npm run compact      # compile into src/managed/
npm test             # 16 tests against the in-memory simulator
```

Ten circuits, but expect this to compile *slower* than its 17-circuit sibling
(roughly 34s versus 19s here). Key generation scales with circuit size, not
count: `burn` alone is k=16 at 47,656 rows, while the fungible token's largest
circuit is k=13 at 4,960. `npm run compact-fast` skips key generation entirely
while you iterate on logic.

---

## 3. The contract, line by line

Two modules, not three. There is no `Pausable` here, to keep the contrast with
the sibling contract clean.

```compact
import "./modules/token/NativeShieldedToken" prefix NativeShieldedToken_;
import "./modules/access/Ownable" prefix Ownable_;

export { NativeShieldedToken__domain };
export { Ownable__owner };
```

Notice how little there is to re-export. That is not an omission, it is the
paradigm.

```compact
constructor(
  domainSep: Bytes<32>,
  name_: Opaque<"string">,
  symbol_: Opaque<"string">,
  decimals_: Uint<8>,
  initialOwner: Either<Bytes<32>, ContractAddress>
) {
  Ownable_initialize(initialOwner);
  NativeShieldedToken_initialize(domainSep, name_, symbol_, decimals_);
}
```

The metadata is declared `sealed`, split across the two modules:

```compact
// NativeShieldedToken.compact
export sealed ledger _domain: Bytes<32>;

// NativeShieldedTokenCore.compact
export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;
```

`sealed` means write-once at construction: the language makes a post-construction
write a *compile-time* error, not a runtime one. So the coin colour this contract
mints is fixed forever the moment it is deployed. The module states the intent
plainly: the domain "is stored as `sealed ledger _domain` at construction and
never exposed as a circuit parameter, eliminating caller-supplied domain misuse".
(`NativeShieldedTokenCore` and `NativeShieldedTokenFamily` *do* take a domain
per call, because a family issues several colours from one contract.)

**Minting, owner only.**

```compact
export circuit mint(
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo {
  Ownable_assertOnlyOwner();
  return NativeShieldedToken__mint(recipient, amount, nonce);
}
```

Same shape as the sibling contract: the policy, then the mechanism. Three details
in that signature are worth pausing on.

**The recipient is a `ZswapCoinPublicKey`, not an account id.** The balance-Map
token addressed people by `Bytes<32>` hashes of their secrets. Coins go to a
Zswap key, because that is what a wallet actually holds.

**You must supply a `nonce`, and it must be unique.** Reusing one for the same
(value, recipient) produces a duplicate commitment, and the ledger rejects it.
With a secret random nonce the mint is *recipient-private*: nobody watching the
chain can tell who received it. If managing nonces yourself sounds like a
footgun, OpenZeppelin ships an optional `NativeShieldedTokenDerivedNonce`
extension that keeps a counter for you. Read its trade-off before reaching for
it: derived nonces are "deterministic and recipient-PUBLIC by design", so you
buy ergonomics with exactly the privacy the previous paragraph described. This
contract does not compose it, so the caller carries both the responsibility and
the privacy.

**`mint` takes `Uint<64>` while `burn` takes `Uint<128>`.** It will look like a
typo the first time you meet it, and it is not the module's decision. Both
modules are explicit that it is "an asymmetry imposed by the protocol
primitives, not a module choice": `mintShieldedToken` caps at 64 bits, while
`sendShielded` accepts 128.

**Burning.**

```compact
export circuit burn(
  coin: ShieldedCoinInfo,
  amount: Uint<128>,
  refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo> {
  Ownable_assertOnlyOwner();
  return NativeShieldedToken__burn(coin, amount, refundTo);
}
```

Coins are indivisible objects, not numbers, so burning part of one means
destroying it and minting the remainder back. That is what the returned
`Maybe<ShieldedCoinInfo>` is: your change. Burn the full value and you get
`is_some: false`. This is the UTXO model, and if you have read
[`shielded-token-contract/docs.md`](../shielded-token-contract/docs.md) you have
met it before.

`burnFromSelf` is the variant for coins the contract already holds, which needs
a `QualifiedShieldedCoinInfo` (a coin plus its Merkle-tree index) rather than a
bare one. It carries an obligation this contract does not meet, and the gap is
worth understanding before you copy it. The module says the consumer **should
persist the returned change coin**, because that change replaces the contract's
holding and "is not otherwise recoverable". This host returns the change and
stores nothing. That is harmless *here* only because there is no circuit for
receiving or holding a coin, so the path is unreachable. Put this contract's
`burnFromSelf` into something that does hold coins, without adding storage for
the change, and a partial burn strands the remainder permanently.

---

## 4. The ledger, and what is not in it

Here is the entire public state of this contract:

```ts
export type Ledger = {
  readonly NativeShieldedToken__domain: Uint8Array;
  readonly Ownable__owner: { is_left: boolean; left: Uint8Array; ... };
}
```

That is it. A domain tag and an owner. There is a test asserting exactly this,
because it is the most instructive fact about the contract:

```ts
expect(Object.keys(ledger).sort()).toEqual([
  "NativeShieldedToken__domain",
  "Ownable__owner"
]);
```

Things that are **absent**, each for a reason:

- **No balances.** Coins are in wallets. The contract has no idea who holds
  what, and neither does anyone reading the chain.
- **No total supply.** Supply accounting is opt-in upstream via the
  `NativeShieldedTokenPublicSupply` extension, which this contract deliberately
  does not compose. The ledger-shape test above asserts the *exhaustive* key
  set, so composing that extension turns it red and this claim cannot quietly
  go stale. (Asserting `not.toHaveProperty("_totalSupply")` would not work: the
  extension's fields are `_totalMinted` and `_totalBurned`, and `totalSupply` is
  a computed circuit, never a ledger key. Such a test can never fail.)
- **No allowances.** There is nothing to approve. You either hold a coin or you
  do not.

A contract whose state does not grow with its user count is a genuinely
different thing from an ERC-20.

---

## 5. Native coin versus balance-Map

The comparison the repo now supports:

| | This contract | [`oz-fungible-token`](../oz-fungible-token-contract/docs.md) |
|---|---|---|
| Value lives | in wallets, as Zswap coins | in a `Map` in contract state |
| Ledger grows with holders | no, it is fixed | yes, one row per holder |
| Balances visible | no | yes, to everyone |
| Recipient addressed by | `ZswapCoinPublicKey` | `Bytes<32>` account-id hash |
| Partial spend | destroy and re-mint change | decrement a number |
| Total supply | not tracked (opt-in) | tracked |
| Forgeable by others | no, colour binds to this address | n/a |
| Is it chain money | **yes** | no, a bookkeeping convention |

Both are honestly called tokens. Neither is more correct. They answer different
questions:

- Reach for **balance-Map** when you want ERC-20 semantics, on-chain
  composability with your own contract logic, or a supply you can query.
- Reach for **native coins** when you want real assets that move independently
  of your contract, privacy over who holds what, and no state growth.

### Where the repo's other token contracts sit

The native-coin column already had residents before this contract arrived:

- [`shielded-token-contract`](../shielded-token-contract/docs.md) and
  [`unshielded-token-contract`](../unshielded-token-contract/docs.md) are
  verbatim ports of the official token-transfers contract. They show the raw
  standard-library calls (`mintShieldedToken`, `sendUnshielded`) with no library
  wrapped around them.
- **This** contract shows the same paradigm with OpenZeppelin's structure on
  top: sealed metadata, a fixed domain, an owner guard, opt-in extensions.

Reading the verbatim port first and this second shows you what the library is
actually buying, which is the honest way to evaluate any library.

---

## 6. What the compiler generates, and the witness it demands

`npm run compact` writes `src/managed/native-shielded-token/`, gitignored and
never committed. Ten circuits under `zkir/` (a full compile writes a `.zkir`
and a `.bzkir` for each), plus `contract/index.d.ts`
carrying the `Ledger` type from §4 and a typed method per circuit.

Two things in there are worth opening.

**The `Witnesses` type**, which tells you what private state you owe:

```ts
export type Witnesses<PS> = {
  wit_OwnableSK(context: WitnessContext<Ledger, PS>): [PS, Uint8Array];
}
```

Just one, and it does not belong to the token. The fungible token needed
`wit_FungibleTokenSK` because it had to derive an account id to use as a `Map`
key. This contract has no map and no accounts, so the token module needs no
private state at all. The only secret in play is the owner's, used by `Ownable`
to prove authority.

The usual warning still applies: a witness runs off-chain in the caller's
wallet, the contract cannot verify it behaves, and supplying a secret key is
*claiming* the identity it hashes to. Treat `src/witnesses.ts` as
security-critical.

**The named coin types.** `src/native-shielded-token.compact` re-exports them:

```compact
export { ShieldedCoinInfo, QualifiedShieldedCoinInfo };
```

Without that line the compiler inlines the shapes anonymously, no named alias
reaches the `.d.ts`, and TypeScript callers reach for the identically-named type
from `@midnight-ntwrk/compact-runtime` instead — whose colour field is `type`,
not `color`. The code still runs, because the objects are right at runtime; only
the types lie. `shielded-token-contract` re-exports for the same reason.

---

## 7. The simulator

Same `CircuitContext` pattern as the rest of the repo, with the coin helper this
paradigm needs:

```ts
static qualify(coin: ShieldedCoinInfo, mtIndex: bigint = 0n): QualifiedShieldedCoinInfo {
  return { nonce: coin.nonce, color: coin.color, value: coin.value, mt_index: mtIndex };
}
```

A freshly minted coin is not yet spendable. It becomes spendable once it has a
Merkle-tree index proving it exists in the ledger's commitment tree. In a real
transaction that index comes from the chain; in phase-1 tests it is set
directly. `shielded-token-contract` documents this same wrinkle at more length.

Caller switching works exactly as in the sibling contract, by swapping the
secret key in private state:

```ts
token.createPrivateState("alice", ALICE.secretKey);
expect(() => token.as("alice").mint(...)).toThrow(/not the owner/i);
```

---

## 8. The tests

16 tests, grouped by what they defend:

| Group | What it pins down |
|---|---|
| deployment | metadata reads back, owner recorded, domain stored |
| **ledger shape** | the state contains *only* a domain and an owner |
| mint | value and nonce are echoed back (catches argument-order bugs) |
| **colour binding** | every coin carries `tokenColor()`, so only this contract can mint it |
| **colour vs nonce** | colour comes from the domain, not the coin nonce |
| non-owner mint reverts | the `assertOnlyOwner` guard is wired up |
| burn full / partial | change is `is_some: false` / the remainder |
| non-owner burn reverts | the guard covers burning too |
| non-owner `burnFromSelf` reverts | and the third owner-gated circuit too |
| **no supply totals** | re-asserts the exhaustive key set after a mint |
| **module-enforced ownership guards** | non-owner `transferOwnership` and `renounceOwnership` both revert |
| renouncing bricks minting | a permanent, irreversible action, tested because it is easy to call by accident |
| ownership transfer | minting rights move, old owner loses them |

Two honest limits, because a phase-1 simulator cannot model everything:

**The suite cannot test `sealed`.** The deployment tests read the metadata back,
which would pass just as well if the fields were ordinary ledger state. Sealing
is enforced by the *compiler*, so a violation is a build error, not a failing
test. There is nothing to assert at runtime.

**The burn tests are not physically realistic.** They mint a coin to Alice's key
and then have the owner burn it, with Alice never taking part. On chain that
cannot happen: `Core__burn` calls `receiveShielded`, which requires the coin to
be a genuine Zswap input, so Alice would have to offer it. The in-memory
simulator does not enforce coin ownership. They still pin the burn *arithmetic*,
which is what they are for, but do not read them as "the owner can destroy coins
sitting in wallets". They cannot. This is the same class of simulator fiction
that [`shielded-token-contract`](../shielded-token-contract/docs.md) documents
at length for `mt_index`.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each.

1. **Break the guard.** Delete `Ownable_assertOnlyOwner()` from `mint`. **Two**
   tests fail, not one: the obvious `rejects a non-owner`, and the last
   assertion of `moves minting rights to the new owner`, which checks that the
   *old* owner can no longer mint. Fourteen still pass. Anyone in the world can
   now mint your token.
2. **Watch a guarantee not be enforced.** Mint twice with the same nonce, value
   and recipient. Nothing throws, and you get back two coins with identical
   nonces. On chain the second would be rejected as a duplicate commitment, but
   that check lives in the ledger, which a phase-1 simulator does not model.
   Worth doing precisely because it teaches where the harness stops: the safety
   property is real, your test environment simply cannot see it.
3. **Change the domain.** Deploy two contracts with different `domainSep` and
   compare `tokenColor()`. They differ, but that alone proves nothing, because
   `simulator.ts` calls `sampleContractAddress()` and colour is
   `tokenType(_domain, kernel.self())` — deploy twice with the *same* domain and
   the colours differ too. To isolate the domain you have to hold the address
   fixed. Then try changing the domain of a deployed contract, and meet `sealed`
   as a compile error.
4. **Add supply tracking.** Vendor **both** `token/extensions/NativeShieldedTokenPublicSupply`
   and `token/extensions/NativeShieldedTokenPublicSupplyCore` (the first imports
   the second), compose them, re-export their ledger fields, and wire
   `Supply__addMinted` into `mint`. The **ledger-shape** tests turn red, because
   `_totalMinted` and `_totalBurned` join the key set. That is the test doing its
   job, and it is why §4 asserts an exhaustive key set rather than the absence of
   a guessed name.
5. **Add a pause.** Vendor `security/Pausable`, guard `mint` with it, and you
   have rebuilt the sibling contract's shape on the native-coin side.
6. **Compare honestly.** Open
   [`shielded-token-contract/docs.md`](../shielded-token-contract/docs.md) next
   to this one and list what OpenZeppelin's structure adds, and what it costs.

---

## 10. Credits & references

- The `NativeShieldedToken`, `NativeShieldedTokenCore`, `Ownable` and `Utils`
  modules in `src/modules/` are **unmodified copies from
  [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts)**,
  pinned at `v0.3.0-alpha.2`, MIT licensed, SPDX headers intact. See
  `src/modules/README.md`.
- **The two native-token modules have never been audited.** OpenZeppelin's May
  2026 audit covered `v0.1.0`, and `NativeShieldedToken` and
  `NativeShieldedTokenCore` did not exist in that release; they first appeared
  in the `v0.3.0-alpha` line. `Ownable` and `Utils` were in the audit's scope,
  but at `v0.1.0` rather than the version vendored here. The repository carries
  its authors' warning: *"This repo contains highly experimental code. Expect
  rapid iteration. Use at your own risk."* Treat this contract as teaching
  material, not as something to put value behind.
- Never import both `NativeShieldedToken` and `NativeShieldedTokenFamily` into
  one contract: they wrap the same `Core` and would share one init flag and one
  set of metadata. Use `Family` instead of `NativeShieldedToken` when a single
  contract must issue several token types.
- The simulator and phase-1 testing pattern is **adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**
  via this repo's [counter-contract](../counter-contract/docs.md); its copyright
  notice is preserved in `vitest.config.ts`. The `qualify` coin helper follows
  [`shielded-token-contract`](../shielded-token-contract/docs.md).
- OpenZeppelin's documentation: <https://docs.openzeppelin.com/contracts-compact>
- Compact language reference:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
