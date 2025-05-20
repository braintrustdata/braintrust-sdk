import { TransactionId } from "./db_fields";

const TOP_BITS = BigInt("0x0DE1") << BigInt(48);
const MOD = BigInt(1) << BigInt(64);
const COPRIME = BigInt("205891132094649");
const COPRIME_INVERSE = BigInt("1522336535492693385");

function modularMultiply(value: bigint, prime: bigint) {
  return (value * prime) % MOD;
}

export function prettifyXact(valueString: TransactionId): string {
  const value = BigInt(valueString);
  const encoded = modularMultiply(value, COPRIME);
  return encoded.toString(16).padStart(16, "0");
}

export function loadPrettyXact(encodedHex: string): TransactionId {
  if (encodedHex.length !== 16) {
    return encodedHex;
  }
  const value = BigInt(`0x${encodedHex}`);
  const multipliedInverse = modularMultiply(value, COPRIME_INVERSE);
  const withTopBits = TOP_BITS | multipliedInverse;
  return withTopBits.toString();
}
