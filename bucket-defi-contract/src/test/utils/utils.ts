import type * as Compact from "../../managed/bucket-defi/contract/index.js";
import {
  encodeRawTokenType,
  encodeContractAddress,
  encodeCoinPublicKey
} from "@midnight-ntwrk/compact-runtime";
import * as ledger from '@midnight-ntwrk/ledger-v6';

const PREFIX_ADDRESS = "0200";

/**
 * @description Create a Uint8Array with random values of an specific lenght
 * @param len Total desired length of the resulting Uint8Array
 * @returns Uint8Array with random values
 */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * @description Converts an ASCII string to its hexadecimal representation,
 * left-padded with zeros to a specified length. Useful for generating
 * fixed-size hex strings for encoding.
 * @param str ASCII string to convert.
 * @param len Total desired length of the resulting hex string. Defaults to 64.
 * @returns Hexadecimal string representation of `str`, padded to `length` characters.
 */
export const toHexPadded = (str: string, len = 64) =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

/**
 * @description Converts a Uint8Array to a hex string
 * @param bytes Uint8Array to convert
 * @returns Hex string representation
 */
export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * @description Generates ZswapCoinPublicKey from `str` for testing purposes.
 *              Uses encodeCoinPublicKey from the library.
 * @param str String to hexify and encode.
 * @returns Encoded `ZswapCoinPublicKey`.
 */
export const encodeToPK = (str: string): Compact.ZswapCoinPublicKey => ({
  bytes: encodeCoinPublicKey(toHexPadded(str))
});

/**
 * @description Creates a caller hex string that matches what encodeToPK produces.
 *              Use this to create callers that are compatible with accounts created by createEitherTestUser.
 * @param str String identifier for the caller.
 * @returns Hex string for use with emptyZswapLocalState.
 */
export const createCaller = (str: string): string =>
  bytesToHex(encodeCoinPublicKey(toHexPadded(str)));

/**
 * @description Generates ContractAddress from `str` for testing purposes.
 *              Prepends 32-byte hex with PREFIX_ADDRESS before encoding.
 * @param str String to hexify and encode.
 * @returns Encoded `ZswapCoinPublicKey`.
 */
export const encodeToAddress = (str: string): Compact.ContractAddress => ({
  bytes: encodeContractAddress(PREFIX_ADDRESS + toHexPadded(str, 60))
});

/**
 * @description Generates an Either object for ZswapCoinPublicKey for testing.
 *              For use when an Either argument is expected.
 *              Uses all-zeros for right to match what the circuit's left() wrapper produces.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ZswapCoinPublicKey.
 */
export const createEitherTestUser = (str: string) => ({
  is_left: true,
  left: encodeToPK(str),
  right: { bytes: new Uint8Array(32) }  // Match circuit's _left_0 which uses all zeros
});

/**
 * @description Generates an Either object for ContractAddress for testing.
 *              For use when an Either argument is expected.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ContractAddress.
 */
export const createEitherTestContractAddress = (str: string) => ({
  is_left: false,
  left: encodeToPK(""),
  right: encodeToAddress(str)
});

/**
 * @description Generates an empty Uint8Array of a specific length.
 * @param str String to hexify and encode.
 * @returns Empty Uint8Array of a specific length.
 */
export const zeroUint8Array = (length = 32) =>
  new Uint8Array(length);


/**
 * @description Generates a ShieldedCoinInfo object for testing purposes.
 * @param value Value of the coin.
 * @returns ShieldedCoinInfo object.
 */
export const coin = (value: number): Compact.ShieldedCoinInfo => {
  return {
    nonce: randomBytes(32),
    color: encodeRawTokenType(ledger.shieldedToken().raw),
    value: BigInt(value),
  };
}

