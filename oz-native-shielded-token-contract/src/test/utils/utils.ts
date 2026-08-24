import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash
} from "@midnight-ntwrk/compact-runtime";

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHexPadded = (str: string, len = 64) =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

export const zeroBytes = new Uint8Array(32);

/**
 * Mirrors `Utils_computeAccountId` from the vendored OpenZeppelin module:
 *
 *   persistentHash<Vector<1, Bytes<32>>>([secretKey])
 *
 * Both `Ownable` and `FungibleToken` identify a caller by this hash, so a test
 * that wants to act as someone must know the secret key behind their id.
 */
export const computeAccountId = (secretKey: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [
    secretKey
  ]);

/** An `Either<Bytes<32>, ContractAddress>` holding a user account id. */
export const asAccount = (accountId: Uint8Array) => ({
  is_left: true,
  left: accountId,
  right: { bytes: zeroBytes }
});

/** An `Either<Bytes<32>, ContractAddress>` holding a contract address. */
export const asContract = (address: Uint8Array) => ({
  is_left: false,
  left: zeroBytes,
  right: { bytes: address }
});

/** A deterministic 32-byte secret key derived from a label, for readable tests. */
export const secretKeyFor = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label).slice(0, 32));
  return sk;
};

/** A named test participant: their secret, their account id, and the Either form. */
export const makeUser = (label: string) => {
  const secretKey = secretKeyFor(label);
  const accountId = computeAccountId(secretKey);
  return { label, secretKey, accountId, either: asAccount(accountId) };
};

/** A `ZswapCoinPublicKey`: 32 bytes wrapped in `{ bytes }`. */
export const coinPublicKey = (label: string): { bytes: Uint8Array } => ({
  bytes: Uint8Array.from(Buffer.from(toHexPadded(label), "hex"))
});

/** An `Either<ZswapCoinPublicKey, ContractAddress>` holding a user key. */
export const asCoinKey = (key: { bytes: Uint8Array }) => ({
  is_left: true,
  left: key,
  right: { bytes: zeroBytes }
});
