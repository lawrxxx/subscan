// Shared domain types. Framework-free so the planner can run in the browser,
// in API routes and in node:test.
import type { TokenSymbol } from "./celo/config.ts";
export type { TokenSymbol };

/** Someone the user sends money to. The address is confirmed once, then never changed. */
export interface Recipient {
  id: string;
  name: string;
  address: `0x${string}`;
  createdAt: string;
  /** When the user confirmed this exact address. Unconfirmed recipients can't receive money. */
  confirmedAt?: string;
  /** Where the money arrives (an exchange or a wallet). Older recipients: "celo_wallet". */
  destination?: DestinationId;
  /** Tokens this destination accepts on Celo, captured when the recipient was saved. */
  tokens?: TokenSymbol[];
}

export type DestinationId = "quidax" | "minipay" | "busha" | "celo_wallet";

/**
 * keep_min       keep at least `amount` of `token`; top up by converting from `fromToken`.
 * convert_below  when `token` falls below `amount`, convert `convertAmount` of `fromToken` into it.
 * reserve_share  keep `sharePct`% of the wallet's value in `token`.
 * transfer_cap   never allow an automated transfer of `token` above `amount`.
 */
export type RuleKind = "keep_min" | "convert_below" | "reserve_share" | "transfer_cap";

export interface MoneyRule {
  id: string;
  name: string;
  kind: RuleKind;
  /** The token the rule protects or targets. */
  token: TokenSymbol;
  /** Threshold (keep_min, convert_below) or cap (transfer_cap), whole token units. */
  amount: string;
  /** reserve_share: percentage 1–99. */
  sharePct?: number;
  /** Token to convert from (keep_min, convert_below, reserve_share). */
  fromToken?: TokenSymbol;
  /** convert_below: how much of `fromToken` to convert each time. */
  convertAmount?: string;
  /** Largest single conversion this rule may make, in `fromToken` units. */
  maxAmount?: string;
  /** Ask before converting instead of converting straight away. */
  askFirst?: boolean;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastRunAt?: string;
  lastOutcome?: string;
}

export type Frequency = "once" | "weekly" | "monthly";

export interface TransferSchedule {
  id: string;
  recipientId: string;
  token: TokenSymbol;
  amount: string; // whole token units
  frequency: Frequency;
  firstDate: string; // yyyy-mm-dd
  endDate?: string;
  /** Stop once this much has been sent in total. */
  maxTotal?: string;
  /** Never send more than this in one transfer. */
  txLimit?: string;
  status: "active" | "paused" | "cancelled" | "ended";
  createdAt: string;
  updatedAt: string;
}

export type ActivityStatus = "scheduled" | "awaiting_approval" | "processing" | "completed" | "failed" | "cancelled";

export interface Activity {
  id: string;
  kind: "transfer" | "conversion";
  status: ActivityStatus;
  createdAt: string;
  updatedAt: string;
  /** One movement per key: `schedule:<id>:<date>` or `rule:<id>:<window>`. */
  key: string;
  scheduleId?: string;
  ruleId?: string;
  /** Scheduled date this transfer belongs to. */
  occurrence?: string;
  token: TokenSymbol;
  amount: string; // human units: sent, or sold for a conversion
  toToken?: TokenSymbol;
  toAmount?: string;
  fee?: string;
  rfqId?: string;
  recipient?: `0x${string}`;
  recipientName?: string;
  txHash?: `0x${string}`;
  /** Set when the browser re-read the receipt and found the expected token movement. */
  verifiedAt?: string;
  error?: string;
  refusals?: string[];
  retryOf?: string;
  note?: string;
}

export interface PaymentWalletState {
  /** The user's non-custodial Altana smart wallet (passkey admin). */
  wallet: `0x${string}`;
  /** The passkey's public credential (id + public key; nothing secret), to sign again on this device. */
  passkey?: { kind: "webauthn"; id: string; publicKey: `0x${string}`; rpId?: string };
  /** Automation switch: when off, nothing runs automatically. */
  enabled: boolean;
  /** Sealed access token from subscan's server (opaque to the browser). */
  sealedPolicy?: string;
  agentPublicKey?: `0x${string}`;
  /** Monthly cap per token, whole units (enforced by the wallet contract). */
  limits: { USDT: string; cNGN: string };
  /** Largest single automated movement per token (checked by subscan's server). */
  maxPerTransfer?: { USDT?: string; cNGN?: string };
  expiry?: number; // unix seconds
  grantTx?: `0x${string}`;
  grantedAt?: string;
  revokedAt?: string;
  revokeTx?: `0x${string}`;
  templateVersion?: number;
}

export interface AppSettings {
  /** The user's everyday wallet (MiniPay, MetaMask), used to add money. */
  wallet?: `0x${string}`;
  agentId?: string;
  agentRegistrationTx?: `0x${string}`;
  payGasInUsdt: boolean;
  displayName?: string;
}

export interface AppState {
  version: 2;
  settings: AppSettings;
  autopilot?: PaymentWalletState;
  recipients: Recipient[];
  rules: MoneyRule[];
  schedules: TransferSchedule[];
  activity: Activity[];
}
