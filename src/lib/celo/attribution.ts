// ERC-8021 transaction attribution — follows Celo's builder guide:
// https://github.com/celo-org/attribution-tags/blob/main/BUILDERS.md
// Every transaction subscan sends carries a calldata suffix with subscan's codes.
// The EVM ignores trailing calldata, so contract behaviour is unchanged.
// Layering rule: only codes that represent subscan itself are added here —
// never platform codes such as "minipay" or "proofofship".
import { codeFromRepo, fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

const VALID = /^[a-z0-9_]{1,32}$/;

/** GitHub repository subscan ships from. The Celo Builders platform derives codes from it. */
export const REPO = "lawrxxx/subscan";
/** Code derived from the repository, exactly as the Celo Builders platform does (codeFromRepo). */
export const REPO_CODE = codeFromRepo(REPO);
/** Code provided for the hackathon registration. Not a secret; NEXT_PUBLIC_CELO_ATTRIBUTION_CODE overrides it. */
export const HACKATHON_CODE = "celo_e97672462153";

const assigned = (process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE || HACKATHON_CODE).trim().toLowerCase();

/**
 * subscan's own code, the assigned hackathon code, and the repo-derived code.
 * Carrying both program codes means attribution is credited whichever one the
 * registry holds for this project (ERC-8021 suffixes support multiple codes).
 */
export const ATTRIBUTION_CODES: string[] = [...new Set(["subscan", ...(VALID.test(assigned) ? [assigned] : []), REPO_CODE])];

/** True when the assigned code is the one the Builders platform would derive from this repo. */
export const ASSIGNED_MATCHES_REPO = assigned === REPO_CODE;

if (!ASSIGNED_MATCHES_REPO && typeof console !== "undefined") {
  // Guide: "check it against your repository" — a stale or copied code credits nobody.
  console.warn(`[attribution] assigned code ${assigned} does not match codeFromRepo("${REPO}") = ${REPO_CODE}; tagging with both.`);
}

export const ATTRIBUTION_SUFFIX: Hex = toDataSuffix(ATTRIBUTION_CODES) as Hex;

/** Append subscan's suffix unless the calldata already ends in an ERC-8021 tag (indexers read only the last one). */
export function tagCalldata(data: Hex): Hex {
  if (fromDataSuffix(data)) return data;
  return concat([data, ATTRIBUTION_SUFFIX]);
}

/** Decode the attribution codes from raw calldata, or null if untagged. */
export function decodeAttribution(input: Hex): string[] | null {
  return fromDataSuffix(input)?.codes ?? null;
}
