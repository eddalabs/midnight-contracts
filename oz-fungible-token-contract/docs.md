# OpenZeppelin Fungible Token

A mintable, pausable, ERC-20-shaped token, assembled from audited OpenZeppelin
parts rather than written from scratch.

This is the first contract in the repo that does not stand alone. Almost none
of the code below is ours: `FungibleToken`, `Ownable` and `Pausable` come from
OpenZeppelin's Compact library, vendored into `src/modules/`. What we wrote is
roughly forty lines of glue, and that glue is the lesson.

If you have read the [counter](../counter-contract/docs.md) and the
[bulletin board](../bulletin-board-contract/docs.md), you have seen contracts
that declare all of their own state. This one is assembled, and learning to
assemble is how real Compact contracts get built.

---

## 1. What this contract does

It is a token in the Ethereum sense. There is a table of balances, and moving
value means editing two rows of that table.

```
_balances: { alice: 1000, bob: 0 }
             --alice transfers 400 to bob-->
_balances: { alice:  600, bob: 400 }
```

Three roles are layered on top:

- **Anyone** can `transfer`, `approve`, and `transferFrom` their own balance.
- **Only the owner** can `mint` new supply, `burn` it, and `pause` the contract.
- **While paused**, all value movement stops. Minting still works.

The important thing to notice early: *nothing here is a coin*. No asset moves
on Midnight's ledger. `_balances` is an ordinary `Map` living in this contract's
public state, and "your balance" means this contract's table says so. That is a
convention, not chain money. Its opposite is the sibling contract,
[`oz-native-shielded-token-contract`](../oz-native-shielded-token-contract/docs.md),
which mints real coins. Section 5 compares them directly.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd oz-fungible-token-contract
npm run compact      # compile fungible-token.compact into src/managed/
npm test             # 11 tests against the in-memory simulator
```

No node, wallet, or proof server needed, same as every other contract here.

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation. Use it
> while iterating; use the full `npm run compact` when you care about real
> proving keys. Compiling this contract produces **17 circuits**, so the
> difference is noticeable.

---

## 3. What a module is

This is the new idea, so it is worth being precise.

Every contract you have seen so far declared its own `ledger` fields and its own
`circuit`s. OpenZeppelin ships something different: a **module**.

```compact
// src/modules/security/Pausable.compact
module Pausable {
  export ledger _isPaused: Boolean;

  export circuit _pause(): [] {
    assertNotPaused();
    _isPaused = true;
  }
}
```

A module is **not a contract**. It has no constructor, it cannot be deployed,
and it cannot even be compiled on its own. It is a bundle of ledger fields and
circuits waiting to be merged into a host. You merge it by importing it with a
prefix:

```compact
import "./modules/security/Pausable" prefix Pausable_;
```

After that line, the module's contents genuinely belong to your contract, with
every exported name rewritten:

| Declared in the module | Becomes, in your contract |
|---|---|
| `ledger _isPaused` | `Pausable__isPaused` |
| `circuit _pause()` | `Pausable__pause()` |
| `circuit isPaused()` | `Pausable_isPaused()` |

The double underscore trips everyone up once. It is just the prefix you chose
(`Pausable_`) followed by a name that already began with an underscore
(`_isPaused`). Nothing clever is happening.

You can see the merge really happened by looking at the generated TypeScript
after compiling:

```ts
export type Ledger = {
  FungibleToken__balances: { ... };
  FungibleToken__totalSupply: bigint;
  Ownable__owner: { is_left: boolean; left: Uint8Array; ... };
  Pausable__isPaused: boolean;
}
```

One flat ledger, contributed by three modules.

### Mechanism, not policy

Now look again at `_pause()`. It has **no access control at all**. Anyone who
can call it can freeze the contract.

That is deliberate, and it is the single most important convention in the
library. OpenZeppelin ships the **mechanism** (flip the flag, with the right
assertions around it) and leaves the **policy** (who is allowed to flip it) to
you. The leading underscore is their marker for "unguarded, you must protect
this."

Their own documentation for the token modules says so outright:

> It does NOT include access control: consuming contracts compose that via the
> module/contract pattern (Ownable, AccessControl, etc.) and SHOULD gate the
> mint and burn circuits.

So an access-control module is not decoration around a token. It is a
prerequisite for using one safely. If you take one idea from this contract,
take that one.

---

## 4. The contract, line by line

Here is our whole contribution. The imports first:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

import "./modules/token/FungibleToken" prefix FungibleToken_;
import "./modules/access/Ownable" prefix Ownable_;
import "./modules/security/Pausable" prefix Pausable_;
```

Then a re-export, which is easy to skip past but matters:

```compact
export { FungibleToken__balances, FungibleToken__allowances, FungibleToken__totalSupply };
export { Ownable__owner };
export { Pausable__isPaused };
```

Importing a module gives *your circuits* access to its state. Re-exporting it
puts it in the generated `Ledger` type, which is what makes it readable from
TypeScript. Skip these lines and the tests cannot see any balances.

The constructor initialises both modules. Order matters only in that each must
run exactly once:

```compact
constructor(
  name_: Opaque<"string">,
  symbol_: Opaque<"string">,
  decimals_: Uint<8>,
  initialOwner: Either<Bytes<32>, ContractAddress>
) {
  Ownable_initialize(initialOwner);
  FungibleToken_initialize(name_, symbol_, decimals_);
}
```

Now the three interesting circuits.

**Supply control, owner only.**

```compact
export circuit mint(
  account: Either<Bytes<32>, ContractAddress>,
  value: Uint<128>
): [] {
  Ownable_assertOnlyOwner();
  FungibleToken__mint(account, value);
}
```

Two lines, and they are the whole pattern: our policy, then their mechanism.
Delete the first line and this contract still compiles, still passes most of its
tests, and lets anybody in the world mint themselves an unlimited balance.

**Value movement, blocked while paused.**

```compact
export circuit transfer(
  to: Either<Bytes<32>, ContractAddress>,
  value: Uint<128>
): Boolean {
  Pausable_assertNotPaused();
  return FungibleToken_transfer(to, value);
}
```

Note `FungibleToken_transfer` has a *single* underscore. It is a public circuit
that guards itself: it checks the caller's balance internally. We add the pause
check because pausing is our policy, not the token's.

**The emergency stop, owner only.**

```compact
export circuit pause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__pause();
}
```

Only circuits that call `assertNotPaused` are affected by pausing. We applied it
to `transfer`, `transferFrom` and `approve`, but deliberately not to `mint`.
There is a test pinning that decision down, because it is a choice, not a
default.

### Two details inherited from the module

**`Uint<128>`, not `Uint<256>`.** ERC-20 uses 256-bit amounts. Compact cannot,
because of encoding limits in Midnight's circuit backend. Every amount here is
128 bits, which is still far more than any real token needs.

**Contract addresses are rejected.** `mint` and `transfer` refuse an
`Either` holding a `ContractAddress`:

```compact
assert(!isContractAddr, "FungibleToken: unsafe transfer");
```

Midnight does not support contract-to-contract calls yet, so a contract that
received tokens could never move them out again. Rather than let value get
stranded, the module refuses. The recipient type is *already* the final
`Either<Bytes<32>, ContractAddress>` so that the signature will not have to
change when C2C arrives.

---

## 5. Public state, and what "owning" means here

Everything this contract knows is public:

```ts
FungibleToken__balances     // Map<account, amount>
FungibleToken__allowances   // Map<owner, Map<spender, amount>>
FungibleToken__totalSupply  // bigint
Ownable__owner              // the account allowed to mint and pause
Pausable__isPaused          // boolean
```

Anyone can read the whole balance table. This token is not private. What *is*
private is identity, and it works in a way worth slowing down for.

There are no signatures here. `Ownable` decides whether you are the owner like
this:

```compact
export circuit assertOnlyOwner(): [] {
  assertInitialized();
  if (_owner.is_left) {
    assert(_computeAccountId() == _owner.left, "Ownable: caller is not the owner");
  } else {
    assert(false, "Ownable: contract address owner authentication is not yet supported");
  }
}
```

and `_computeAccountId()` is just a hash of a secret you supply:

```compact
export pure circuit computeAccountId(secretKey: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<1, Bytes<32>>>([secretKey]);
}
```

So an "account" is a hash, and proving you own it means proving in
zero-knowledge that you know its preimage. The ledger stores
`Ownable__owner = hash(secret)` and never learns the secret.

If that feels familiar, it should. The bulletin board hand-rolls exactly this
idea:

```compact
// bulletin-board-contract/src/bulletin-board.compact
pure circuit compute_author_commitment(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "bboard:author:"), sk]);
}
```

Same technique, one written by hand for one contract, the other packaged and
audited for reuse. Seeing your own pattern show up in a library is a good sign
you understood it.

### Balance-Map versus native coin

| | This contract | [`oz-native-shielded-token`](../oz-native-shielded-token-contract/docs.md) |
|---|---|---|
| Where value lives | a `Map` in this contract's state | coins in users' wallets |
| What `transfer` does | edits two rows of a table | n/a, coins move as real Zswap assets |
| Ledger size | grows with every holder | fixed: a domain and an owner |
| Who can see balances | everyone | nobody |
| Is it chain money? | no, a bookkeeping convention | yes |

Both are called "tokens" and both come from OpenZeppelin, but they are
different machines. Reading the two contracts side by side is the fastest way
to internalise the difference. Your existing
[`shielded-token-contract`](../shielded-token-contract/docs.md) and
[`unshielded-token-contract`](../unshielded-token-contract/docs.md) sit on the
native-coin side of this table too.

---

## 6. What the compiler generates

`npm run compact` writes `src/managed/fungible-token/`, which is gitignored and
never committed. Three things inside matter:

- **`contract/index.d.ts`** — the `Ledger` type shown in §3, plus a typed method
  per circuit and, importantly, the `Witnesses` type telling you exactly what
  private state you owe the contract.
- **`zkir/`** — one file per circuit, 17 of them here: `mint`, `burn`,
  `transfer`, `transferFrom`, `approve`, `pause`, `unpause`,
  `transferOwnership`, `renounceOwnership`, and the read-only getters.
- **`compiler/contract-info.json`** — metadata.

The generated `Witnesses` type is the useful one:

```ts
export type Witnesses<PS> = {
  wit_FungibleTokenSK(context: WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_OwnableSK(context: WitnessContext<Ledger, PS>): [PS, Uint8Array];
}
```

You never wrote either of those names. Both arrived from the modules, and the
compiler is now telling you that this contract will not run until you supply
them.

---

## 7. Witnesses and private state

A module can demand private state from its host. Both of ours do, and both want
the same thing: a 32-byte secret.

```ts
// src/witnesses.ts
export type FungibleTokenPrivateState = {
  readonly secretKey: Uint8Array;
};

export const witnesses = {
  wit_OwnableSK: ({ privateState }) => [privateState, privateState.secretKey],
  wit_FungibleTokenSK: ({ privateState }) => [privateState, privateState.secretKey]
};
```

That is the entire private state of this contract: one secret, read by two
witnesses.

**Witnesses are security-critical.** A witness runs off-chain, in the caller's
wallet, and the contract has no way to check that it behaves. Whoever supplies a
secret key is *claiming* an identity, and the circuit only verifies that the
hash matches. OpenZeppelin is emphatic about this and ships their own witnesses
marked test-only and unaudited, precisely so nobody treats them as a product.
Ours are written fresh for this workspace and carry the same warning.

---

## 8. The simulator and the tests

`src/test/simulators/simulator.ts` follows the same `CircuitContext` pattern as
every other contract here, with one addition worth knowing.

Because identity is a secret key rather than a signature, the simulator can
switch who is calling by swapping private state:

```ts
token.createPrivateState("alice", ALICE.secretKey);
token.as("alice").transfer(BOB.either, 400n);
```

`as(name)` swaps in that user's secret before running the circuit, which is
exactly what a different wallet would do. To build a user, the tests mirror the
module's own hash:

```ts
// src/test/utils/utils.ts
export const computeAccountId = (secretKey: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [secretKey]);
```

The 11 tests pin down behaviour that would otherwise be assumption:

| Test | What it protects |
|---|---|
| owner mints, supply moves | the happy path |
| **non-owner mint reverts** | our `assertOnlyOwner` guard is actually wired up |
| contract-address recipient reverts | the C2C safety guard |
| transfer moves balances | the core mechanic |
| **transfer leaves total supply unchanged** | value is moved, never created |
| over-balance transfer reverts | the module's own check |
| paused blocks transfer, unpause restores | the stop actually stops things |
| non-owner pause reverts | the pause guard |
| **mint still works while paused** | our deliberate choice to exempt minting |
| ownership transfer moves the powers | and revokes the old owner |

The bolded ones are the interesting ones: they encode decisions rather than
mechanics, and they would silently break if someone rearranged the guards.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each.

1. **Break it on purpose.** Delete `Ownable_assertOnlyOwner()` from `mint`.
   Which test fails? Notice how many still pass, and sit with that for a
   moment: the contract is now catastrophically broken and most of the suite is
   still green.
2. **Move a guard.** Add `Pausable_assertNotPaused()` to `mint`. Which existing
   test fails, and do you agree with the choice it was defending?
3. **Read the ledger yourself.** Log `getLedger().FungibleToken__balances` after
   a mint. It is a `Map` with `lookup` and `member`, not a plain object.
4. **Follow the prefix.** Rename the import prefix from `FungibleToken_` to
   `Tok_`. Everything still works if you rename consistently. What does that
   tell you about how much of "the module" is really just a naming convention?
5. **Add a cap.** Give the contract a `maxSupply` and assert against it in
   `mint`. You are now writing policy of your own, which is exactly what the
   library expects you to do.
6. **Compare the paradigms.** Read
   [`oz-native-shielded-token-contract/docs.md`](../oz-native-shielded-token-contract/docs.md)
   and write down, in your own words, where a balance lives in each.

---

## 10. Credits & references

- The `FungibleToken`, `Ownable`, `Pausable` and `Utils` modules in
  `src/modules/` are **unmodified copies from
  [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts)**,
  pinned at `v0.3.0-alpha.2`, MIT licensed, with their SPDX headers intact.
  See `src/modules/README.md` for the vendoring policy. That library is
  explicitly labelled highly experimental by its authors.
- The simulator and phase-1 testing pattern is **adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**,
  via this repo's [counter-contract](../counter-contract/docs.md). Its copyright
  notice is preserved in `vitest.config.ts`.
- The `persistentHash` account-id helper in the tests mirrors
  `Utils_computeAccountId` from the vendored module.
- OpenZeppelin's own documentation: <https://docs.openzeppelin.com/contracts-compact>
- Compact language reference:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
