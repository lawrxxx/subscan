// The exact session an Autopilot grant asks for. Shared by the browser (grant)
// and the server (execute): Altana requires the permissions, expiry and public
// key used at execute to equal what was granted, so both sides build them here.
//
// What the account contract enforces on-chain for this session:
//  - calls: only USD₮.approve, USD₮.transfer, cNGN.transfer, and the Textile FX
//    reactor. Any other contract or function reverts at validation.
//  - spend: a monthly cap per token (UTC calendar month), which also covers the
//    relay fee when it is paid in that token.
//  - expiry: after it, the key is dead with no transaction.
// What it cannot enforce: the recipient of a transfer (calls have no argument
// rules). subscan's server checks the approved-recipient list before signing.
import { parseUnits } from "viem";
import { TEXTILE, TOKENS, type TokenSymbol } from "../celo/config.ts";

export const AUTOPILOT_PERIOD = "month" as const;

export interface AutopilotLimits {
  /** Monthly cap per token, in whole token units (e.g. "50" USD₮). */
  USDT: string;
  cNGN: string;
}

export function autopilotPermissions(limits: AutopilotLimits) {
  const cap = (t: TokenSymbol) => parseUnits(limits[t] || "0", TOKENS[t].decimals);
  return {
    calls: [
      { to: TOKENS.USDT.address, signature: "approve(address,uint256)" },
      { to: TOKENS.USDT.address, signature: "transfer(address,uint256)" },
      { to: TOKENS.cNGN.address, signature: "transfer(address,uint256)" },
      { to: TEXTILE.reactor },
    ],
    spend: [
      { token: TOKENS.USDT.address, limit: cap("USDT"), period: AUTOPILOT_PERIOD },
      { token: TOKENS.cNGN.address, limit: cap("cNGN"), period: AUTOPILOT_PERIOD },
    ],
  } as const;
}

/** App codes for Altana's ERC-8021 tag: `altana,subscan,celo_…`. */
export const AUTOPILOT_APP_CODES = ["subscan", "celo_e97672462153"];
