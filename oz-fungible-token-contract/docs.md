# OpenZeppelin Fungible Token

A mintable, pausable, ERC-20-shaped token built from OpenZeppelin's Compact
modules.

Every other contract in this repo is a single self-contained `.compact` file
that declares all of its own ledger state and circuits. This one is the first
built by composition: it imports `FungibleToken`, `Ownable` and `Pausable` from
`src/modules/` and adds about forty lines wiring them together.

That is the reason to read it. Composing modules is how most real Compact
contracts get built, and it works differently enough from writing one file that
it needs its own walkthrough.

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

- **Anyone** can `transfer` their own balance, `approve` a spender, or use
  `transferFrom` to move a balance someone else has approved them to spend.
- **Only the owner** can `mint`, `burn`, and `pause` the contract.
- **While paused**, ordinary transfers stop. Minting and burning still work.

Read that second line carefully, because it is stronger than it looks. `burn`
takes an arbitrary account: the owner can destroy **any holder's** balance
without their consent. That is inherited from the module, which checks only that
the target has the funds, and §4 comes back to it.

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
npm test             # 21 tests against the in-memory simulator
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

A module is **not a contract**. It has no constructor and nothing to deploy:
point the compiler at `Pausable.compact` alone and it succeeds, but what comes
out is empty — `Ledger = {}`, `Circuits = {}`, not even a `zkir/` directory. The
ledger field and the circuits only become real once a host takes them on. You
merge it by importing it with a prefix:

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
  FungibleToken__allowances: { ... };
  readonly FungibleToken__totalSupply: bigint;
  readonly Ownable__owner: { is_left: boolean; left: Uint8Array; ... };
  readonly Pausable__isPaused: boolean;
}
```

One flat ledger, five fields, contributed by three modules.

### Mechanism, not policy

Now look again at `_pause()`. It has **no access control at all**. Anyone who
can call it can freeze the contract.

That is deliberate, and it is the single most important convention in the
library. OpenZeppelin ships the **mechanism** (flip the flag, with the right
assertions around it) and leaves the **policy** (who is allowed to flip it) to
you. The leading underscore is their marker for "unguarded, you must protect
this."

Their own documentation says so outright. This is from `NativeShieldedToken`,
the module behind the [sibling contract](../oz-native-shielded-token-contract/docs.md),
which states the shared convention most directly:

> It does NOT include access control: consuming contracts compose that via the
> module/contract pattern (Ownable, AccessControl, etc.) and SHOULD gate the
> mint and burn circuits, which are unrestricted at the module level.

`FungibleToken` carries no such sentence, but behaves identically: its `_mint`
and `_burn` are equally unguarded. So an access-control module is not decoration
around a token. It is a prerequisite for using one safely. If you take one idea
from this contract, take that one.

---

## 4. The contract, line by line

The imports first:

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

Two lines, and they are the whole pattern: the policy, then the mechanism.
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
that guards itself: it checks the caller's balance internally. The pause check
is added here because pausing is this contract's policy, not the token's.

**The emergency stop, owner only.**

```compact
export circuit pause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__pause();
}
```

Only circuits that call `assertNotPaused` are affected by pausing. It is applied
here to `transfer`, `transferFrom` and `approve`, and deliberately not to the two
owner-only supply circuits, `mint` and `burn`. Tests pin both exemptions down,
because they are choices rather than defaults.

Why exempt them? Pausing could not protect against a hostile owner anyway, since
`unpause` is itself owner-only and they would simply lift it first. The pause
switch guards *user-initiated* value movement; owner-only supply control sits
outside it.

Which brings up the thing to notice about `burn`:

```compact
export circuit burn(account, value): [] {
  Ownable_assertOnlyOwner();
  FungibleToken__burn(account, value);
}
```

`account` is arbitrary. Inside the module, the only check on the way out is
`assert(fromBal >= value, "FungibleToken: insufficient balance")`. There is no
check that the caller owns that balance. **The owner can zero out any holder at
will**, and so can anyone who steals the owner key. That may be exactly what you
want (a regulated asset with clawback) or completely unacceptable (a token users
are asked to trust). Either way it is a decision to make deliberately, not
inherit by accident. A test pins it so nobody discovers it in production.

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

That `_computeAccountId()` is `Ownable`'s own private helper, which calls the
witness and hands the secret to a shared utility. The hashing itself lives one
module over, in `Utils.compact`, and is just:

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

Same idea, arrived at twice: hash a secret, store the hash, prove the preimage.
Seeing your own pattern show up in a library is a good sign you understood it.

But look at what differs, because it matters more than it appears. The bulletin
board hashes a `Vector<2>` with a domain tag (`"bboard:author:"`); OZ hashes a
bare `Vector<1>`. That is not a stylistic choice, and `Ownable`'s own comments
call it out: because the account id is `H(secretKey)` with no per-deployment
salt or domain separator, **the same secret key produces the same identity in
every contract that uses this module**, and that is intentional. One identity,
reusable everywhere — convenient, and linkable across contracts by anyone
watching. The hand-rolled bulletin-board version, by adding a domain tag, is
actually the more private of the two. If you want an owner who cannot be
correlated across deployments, `ZOwnablePK` is the module that provides it.

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
- **`zkir/`** — the circuit IR, 17 circuits here (a full `npm run compact` writes
  a `.zkir` and a `.bzkir` for each): `mint`, `burn`,
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

A module can demand private state from its host. Both modules here do, and both
want the same thing: a 32-byte secret.

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
hash matches. OpenZeppelin is emphatic about this: they ship their own witnesses
stamped "TEST-ONLY WITNESS. NOT FOR PRODUCTION USE", precisely so nobody treats
them as a product. The ones in this workspace were written for it rather than
copied, and they are teaching material under the same terms: read them, do not
ship them.

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

The 21 tests pin down behaviour that would otherwise be assumption:

| Test | What it protects |
|---|---|
| deployment records owner, unpaused, empty | the starting state |
| owner mints, supply moves | the happy path |
| **non-owner mint reverts** | the `assertOnlyOwner` guard is actually wired up |
| contract-address recipient reverts | the C2C safety guard |
| transfer moves balances | the core mechanic |
| **transfer leaves total supply unchanged** | value is moved, never created |
| over-balance transfer reverts | matched on `insufficient balance`, see below |
| paused blocks transfer, unpause restores | the stop actually stops things |
| non-owner pause reverts | the pause guard |
| **mint still works while paused** | a deliberate choice to exempt supply control |
| burn destroys supply and balance | the mechanic |
| **burn takes a balance the owner does not hold** | the confiscation power, pinned so it cannot surprise anyone |
| non-owner burn reverts | the guard |
| **burn still works while paused** | the second deliberate exemption |
| approve then transferFrom | allowances move someone else's balance |
| over-allowance transferFrom reverts | matched on `insufficient allowance` |
| paused blocks approve and transferFrom | the pause covers all three movement circuits |
| **non-owner transferOwnership / renounceOwnership revert** | the only guards this contract does not apply itself |
| renouncing bricks minting | permanent and irreversible, so worth knowing |
| ownership transfer moves the powers | and revokes the old owner |

The bolded ones encode decisions rather than mechanics, and would silently break
if someone rearranged the guards.

One test is worth explaining, because its first version was weak. "Over-balance
transfer reverts" now matches on the message `insufficient balance` rather than
using a bare `toThrow()`. The reason: the line immediately after the module's
`assert(fromBal >= value, ...)` computes `fromBal - value as Uint<128>`, which
underflows and panics by itself. A bare `toThrow()` therefore stayed green even
with that assert deleted — it was testing the underflow, not the check it named.
A reverting test that does not match its message is often testing less than it
appears to.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each.

1. **Break it on purpose.** Delete `Ownable_assertOnlyOwner()` from `mint`.
   **Two** tests fail: `rejects a non-owner`, and the final assertion of the
   ownership-transfer test, which checks the *old* owner can no longer mint.
   Nineteen still pass. Sit with that for a moment: the contract is now
   catastrophically broken and most of the suite is still green.
2. **Move a guard.** Add `Pausable_assertNotPaused()` to `mint`. The
   "mint still works while paused" test fails. Do you agree with the choice it
   was defending? The reasoning is in §4.
3. **Read the ledger yourself.** Log `getLedger().FungibleToken__balances` after
   a mint. It is a `Map` with `lookup` and `member`, not a plain object.
4. **Follow the prefix.** Rename the import prefix `FungibleToken_` to `Tok_`.
   Rename it consistently in the contract and everything compiles — but the
   tests go red, because the generated ledger keys become `Tok__totalSupply` and
   the assertions still say `FungibleToken__totalSupply`. Fixing those too is
   the point: the prefix is not decoration, it reaches all the way into the
   TypeScript your tests read.
5. **Add a cap.** Give the contract a `maxSupply` and assert against it in
   `mint`. You are now writing policy of your own, which is exactly what the
   library expects you to do.
6. **Decide about `burn`.** Restrict it so the owner can only burn their own
   balance, and watch the confiscation test fail. Whether that is a fix or a
   regression depends entirely on what you are building, which is why the
   behaviour is tested rather than assumed.
7. **Compare the paradigms.** Read
   [`oz-native-shielded-token-contract/docs.md`](../oz-native-shielded-token-contract/docs.md)
   and write down, in your own words, where a balance lives in each.

---

## 10. Credits & references

- The `FungibleToken`, `Ownable`, `Pausable` and `Utils` modules in
  `src/modules/` are **unmodified copies from
  [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts)**,
  pinned at `v0.3.0-alpha.2`, MIT licensed, with their SPDX headers intact.
  See `src/modules/README.md` for the vendoring policy.
- **On "audited".** OpenZeppelin commissioned a full audit of the library in
  May 2026, and all four modules used here were in its scope. That audit covered
  **`v0.1.0`**, not the `v0.3.0-alpha.2` vendored here, and these files have
  changed since (the pragma alone moved from `0.21` to `0.23`). The repository
  still carries the authors' own warning: *"This repo contains highly
  experimental code. Expect rapid iteration. Use at your own risk."* Worth
  internalising generally: an audit is a statement about one commit, not a
  permanent property of a library.
- The simulator and phase-1 testing pattern is **adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**,
  via this repo's [counter-contract](../counter-contract/docs.md). Its copyright
  notice is preserved in `vitest.config.ts`.
- The `persistentHash` account-id helper in the tests mirrors
  `Utils_computeAccountId` from the vendored module.
- OpenZeppelin's own documentation: <https://docs.openzeppelin.com/contracts-compact>
- Compact language reference:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
