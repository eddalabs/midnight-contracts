// This contract uses no witnesses and holds no ledger state: it is a library of
// shielded-token circuits. We still declare a (trivial) private-state type so
// the test harness has something to thread through, mirroring the other
// contracts in this repo.
export type ShieldedTokenPrivateState = {
  readonly _unused: number;
};

export const createPrivateState = (
  value: number
): ShieldedTokenPrivateState => {
  return { _unused: value };
};

export const witnesses = {};
