// Shared domain types. Kept framework-free so detection + agent tools can run
// in the browser, in API routes and in node:test.

export type Currency = string; // ISO-4217 style code, e.g. "NGN", "USD"

export interface Transaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  merchant: string; // normalised merchant key/label
  amount: number; // always positive; see direction
  currency: Currency;
  /** Money out (debit) or in (credit). Older records without it are debits. */
  direction?: "debit" | "credit";
  source: "csv" | "pdf" | "sample" | "manual" | "mono";
  /** Stable key for de-duplicating repeat imports of the same statement. */
  fingerprint?: string;
}

/** Subscriptions, utilities, and other recurring obligations (rent, loans, insurance…). */
export type ObligationKind = "subscription" | "utility" | "obligation";
/** Fixed bills charge the same each time; variable bills (e.g. electricity) move around. */
export type BillType = "fixed" | "variable";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

export type SubscriptionStatus = "detected" | "confirmed" | "dismissed";

export interface PricePoint {
  date: string;
  amount: number;
}

export interface PaymentTarget {
  // How the merchant is settled. Only "address" and "x402" are supported, both
  // must be supplied/verified by the user — subscan never invents recipients.
  method: "address" | "x402";
  address?: `0x${string}`;
  x402Url?: string;
  token: "cNGN" | "USDT";
  verifiedAt?: string;
  note?: string;
}

export interface Subscription {
  id: string;
  merchant: string;
  displayName: string;
  category: string;
  amount: number; // latest charge
  currency: Currency;
  frequency: Frequency;
  intervalDays: number; // median observed interval
  lastCharge: string;
  nextRenewal: string;
  firstSeen: string;
  chargeCount: number;
  totalSpent: number;
  history: PricePoint[];
  confidence: number; // 0..1
  confidenceReasons: string[];
  status: SubscriptionStatus;
  priceChange?: { from: number; to: number; date: string; pct: number };
  international: boolean; // billed in a currency other than the home currency
  lapsed?: boolean; // no charge for more than ~2 billing periods — probably cancelled
  kind?: ObligationKind; // defaults to "subscription" for older records
  billType?: BillType; // defaults to "fixed"
  /** Typical amount for variable bills (median of recent charges). */
  typicalAmount?: number;
  /** An expected charge that is missing from the statement period. */
  missed?: { expected: string };
  /** Latest charge is far above the usual amount. */
  unusual?: { amount: number; typical: number; date: string };
  manual?: boolean; // added by the user rather than detected
  payment?: PaymentTarget;
  edited?: boolean;
}

export type PaymentStepKind = "approval" | "conversion" | "settlement";
export type PaymentStatus = "prepared" | "pending" | "confirmed" | "failed";

export interface PaymentStep {
  kind: PaymentStepKind;
  label: string;
  status: PaymentStatus;
  hash?: `0x${string}`;
  error?: string;
  at?: string;
}

export interface PaymentRecord {
  id: string;
  createdAt: string;
  subscriptionId: string;
  merchant: string;
  sourceToken: "USDT" | "cNGN";
  destinationToken: "USDT" | "cNGN";
  sourceAmount: string; // human units
  destinationAmount: string; // human units
  feeAmount?: string;
  rate?: string;
  recipient?: string;
  method: "address" | "x402";
  rfqId?: string;
  steps: PaymentStep[];
  status: PaymentStatus;
  from?: `0x${string}`;
}

export interface AppSettings {
  homeCurrency: Currency;
  wallet?: `0x${string}`;
  agentId?: string;
  agentRegistrationTx?: `0x${string}`;
  payGasInUsdt: boolean;
  displayName?: string;
  onboarded?: boolean;
}

export interface AppState {
  transactions: Transaction[];
  subscriptions: Subscription[];
  payments: PaymentRecord[];
  settings: AppSettings;
  importedAt?: string;
  dataSource?: "csv" | "pdf" | "sample" | "mono";
  /** Imports performed, newest first (metadata only — raw files are never stored). */
  imports?: ImportRecord[];
  /** Actions the user approved from the agent workspace (newest first). */
  actions?: AgentAction[];
}

export interface ImportRecord {
  id: string;
  at: string;
  fileName: string;
  format: string; // e.g. "csv", "pdf: generic table"
  rows: number; // rows added
  duplicates: number; // rows skipped as already imported
  from?: string;
  to?: string;
}

export interface AgentAction {
  id: string;
  at: string;
  kind: "confirmed" | "dismissed" | "restored" | "recategorised" | "payment-prepared" | "payment-sent";
  title: string;
  detail?: string;
  href?: string;
}
