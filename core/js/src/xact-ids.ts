import { TransactionId } from "./db_fields";

function modularMultiply(value: bigint, prime: bigint, mod = BigInt(2 ** 48)) {
  return (value * prime) % mod;
}

const coprime = BigInt(205891132094649);
const coprimeInverse = BigInt(119861441465737);
const topBits = BigInt("0x0DE1") << BigInt(48);

export function prettifyXact(valueString: TransactionId): string {
  const value = BigInt(valueString);
  const encoded = modularMultiply(value, coprime);
  return encoded.toString(16).padStart(12, "0");
}

export function loadPrettyXact(encodedHex: string): TransactionId {
  const value = BigInt(`0x${encodedHex}`);
  const multipliedInverse = modularMultiply(value, coprimeInverse);
  const withTopBits = topBits | multipliedInverse;
  return withTopBits.toString();
}
