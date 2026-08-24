# Vendored OpenZeppelin Compact modules

These `.compact` files are **unmodified copies** from OpenZeppelin's Compact
contract library. They are vendored (committed here) rather than installed, so
this workspace compiles with no extra dependency.

| | |
|---|---|
| Upstream | https://github.com/OpenZeppelin/compact-contracts |
| Pinned version | `v0.3.0-alpha.2` |
| Upstream path | `contracts/src/<group>/<Module>.compact` |
| Licence | MIT (headers left intact in every file) |
| Targets | Compact compiler `0.31.0`, `pragma language_version >= 0.23.0` |

## Do not edit these files

Local edits would silently diverge from upstream and make a future re-sync
guesswork. To update, re-copy from the tag above and bump the version in this
table.

Note the directory layout is load-bearing: `access/Ownable.compact` does
`import "../utils/Utils"`, so `access/` and `utils/` must stay siblings.

## Why these modules ship ungated

Every `_`-prefixed circuit (`NativeShieldedToken__mint`, `NativeShieldedToken__burn`) has **no
access control on purpose**. OpenZeppelin provides the mechanism and leaves the
policy to the contract that imports it. Guarding them is the host contract's
job; see `../native-shielded-token.compact`.
