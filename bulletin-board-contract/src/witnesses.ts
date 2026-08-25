// Private state for the bulletin board contract
export type BulletinBoardPrivateState = {
  secretKey: Uint8Array;
};

export const createPrivateState = (secretKey: Uint8Array): BulletinBoardPrivateState => {
  return {
    secretKey,
  };
};

// Witness context type
type WitnessContext<T> = {
  privateState: T;
};

// Witness implementations - these run locally and provide private data to circuits
// Each witness returns [nextPrivateState, result] tuple
export const witnesses = {
  local_secret_key: (
    context: WitnessContext<BulletinBoardPrivateState>,
  ): [BulletinBoardPrivateState, Uint8Array] => {
    // Return the private state unchanged and the secret key
    return [context.privateState, context.privateState.secretKey];
  },
};
