// Server-side validation for everything written to the database.
import { z } from "zod";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid address").transform((v) => v as `0x${string}`);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash").transform((v) => v as `0x${string}`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");
const ccy = z.string().regex(/^[A-Z]{3}$/);
const token = z.enum(["USDT", "cNGN"]);
const status = z.enum(["detected", "confirmed", "dismissed"]);
const frequency = z.enum(["weekly", "monthly", "quarterly", "yearly"]);

export const TransactionIn = z.object({
  id: z.string().min(1).max(120),
  date: isoDate,
  description: z.string().trim().min(1).max(300),
  merchant: z.string().min(1).max(120),
  amount: z.number().positive().max(1e12),
  currency: ccy,
  source: z.enum(["csv", "sample", "mono"]),
});

export const ImportIn = z.object({
  source: z.enum(["csv", "sample"]),
  transactions: z.array(TransactionIn).min(1).max(20_000),
});

export const PaymentTargetIn = z
  .object({
    method: z.enum(["address", "x402"]),
    address: addr.optional(),
    x402Url: z.string().url().startsWith("https://").max(500).optional(),
    token,
    verifiedAt: z.string().max(40).optional(),
    note: z.string().max(300).optional(),
  })
  .refine((p) => (p.method === "address" ? !!p.address : !!p.x402Url), "Address or x402 URL required");

export const SubscriptionPatch = z
  .object({
    status,
    displayName: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(40),
    amount: z.number().positive().max(1e12),
    frequency,
    intervalDays: z.number().int().min(1).max(400),
    nextRenewal: isoDate,
    payment: PaymentTargetIn.nullable(),
    edited: z.boolean(),
  })
  .partial()
  .strict();

const step = z.object({
  kind: z.enum(["approval", "conversion", "settlement"]),
  label: z.string().max(200),
  status: z.enum(["prepared", "pending", "confirmed", "failed"]),
  hash: hash.optional(),
  error: z.string().max(500).optional(),
  at: z.string().max(40).optional(),
});

export const PaymentIn = z.object({
  id: z.string().regex(/^pay_[a-z0-9]{4,32}$/),
  createdAt: z.string().max(40),
  subscriptionId: z.string().min(1).max(160),
  merchant: z.string().min(1).max(80),
  sourceToken: token,
  destinationToken: token,
  sourceAmount: z.string().max(40),
  destinationAmount: z.string().max(40),
  feeAmount: z.string().max(80).optional(),
  rate: z.string().max(120).optional(),
  recipient: addr.optional(),
  method: z.enum(["address", "x402"]),
  rfqId: z.string().max(120).optional(),
  steps: z.array(step).min(1).max(6),
  status: z.enum(["prepared", "pending", "confirmed", "failed"]),
  from: addr.optional(),
});

export const ProfilePatch = z
  .object({
    displayName: z.string().trim().max(80).nullable(),
    homeCurrency: z.enum(["NGN", "USD"]),
    payGasInUsdt: z.boolean(),
    wallet: addr.nullable(),
    agentId: z.string().regex(/^\d{1,78}$/).nullable(),
    agentRegistrationTx: hash.nullable(),
    onboarded: z.boolean(),
  })
  .partial()
  .strict();

export function zodMessage(e: z.ZodError) {
  return e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).slice(0, 4).join("; ");
}
