// Shared domain types. Kept framework-free so detection + agent tools can run
// in the browser, in API routes and in node:test.

export type Currency = string; // ISO-4217 style code, e.g. "NGN", "USD"

export interface Transaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  merchant: string; // normalised merchant key/label
  amount: number; // positive = money out
  currency: Currency;
  source: "csv" | "sample" | "mono";
}

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
  dataSource?: "csv" | "sample" | "mono";
}
