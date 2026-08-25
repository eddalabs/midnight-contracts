# Vendored OpenZeppelin Compact modules

These `.compact` files are **unmodified copies** from OpenZeppelin's Compact
contract library. They are vendored (committed here) rather than installed, so
this workspace compiles with no extra dependency.

| | |
|---|---|
| Upstream | https://github.com/OpenZeppelin/compact-contracts |
| Pinned version | `v0.3.0-alpha.2` |
| Upstream path | `contracts/src/<group>/<Module>.compact` |
| Licence | MIT — full notice in [LICENSE-MIT](LICENSE-MIT), SPDX headers intact in every file |
| Targets | Compact compiler `0.31.0`, `pragma language_version >= 0.23.0` |
| Audit status | **not this version.** See below. |

## Audit status

OpenZeppelin commissioned a full audit of the library in May 2026, covering
`v0.1.0`. The version pinned here is newer and has changed since. Some modules
in the `v0.3.0-alpha` line, including the native shielded token, did not exist
at `v0.1.0` and have never been audited at all.

The upstream repository carries its authors' own warning: *"This repo contains
highly experimental code. Expect rapid iteration. Use at your own risk."*

These workspaces are teaching material. Do not put value behind them.

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
