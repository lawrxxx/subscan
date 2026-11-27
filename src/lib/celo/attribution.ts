// ERC-8021 transaction attribution (https://docs.celo.org/build/agents/attribution-tags).
// Every transaction subscan builds carries a calldata suffix with subscan's app
// code and, when set, the code a hackathon/program assigned. The suffix is
// ignored by the EVM, so contract behaviour is unchanged.
// Layering rule: only codes representing subscan itself are added here —
// never platform codes such as "minipay".
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

const VALID = /^[a-z0-9_]{1,32}$/;

/** Code issued to subscan by the Celo hackathon. Not a secret; the env var can override it. */
export const HACKATHON_CODE = "celo_e97672462153";

const assigned = (process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE || HACKATHON_CODE).trim().toLowerCase();

/** subscan's own code first, then the program-assigned code (required for credit) if configured. */
export const ATTRIBUTION_CODES: string[] = ["subscan", ...(VALID.test(assigned) && assigned !== "subscan" ? [assigned] : [])];

export const ATTRIBUTION_SUFFIX: Hex = toDataSuffix(ATTRIBUTION_CODES) as Hex;

export function hasAttribution(data: Hex): boolean {
  return data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase()) || fromDataSuffix(data) !== null;
}

/** Append subscan's suffix unless the calldata already ends in an ERC-8021 tag (indexers read only the last one). */
export function tagCalldata(data: Hex): Hex {
  if (fromDataSuffix(data)) return data;
  return concat([data, ATTRIBUTION_SUFFIX]);
}

/** Decode the attribution codes from a transaction's input, or null if untagged. */
export function decodeAttribution(input: Hex): string[] | null {
  return fromDataSuffix(input)?.codes ?? null;
}
