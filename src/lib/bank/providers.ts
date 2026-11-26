// Bank data providers. CSV import is fully implemented. Mono is structured as a
// provider slot so a verified Mono Connect integration can be dropped in later;
// it reports "not configured" and never pretends an account is linked.
import { parseTransactionsCsv, type ParseResult } from "../detection/csv.ts";

export interface BankDataProvider {
  id: "csv" | "mono";
  label: string;
  available: boolean;
  status: string;
}

export const csvProvider = {
  id: "csv" as const,
  label: "Upload a statement (CSV)",
  available: true,
  status: "Ready",
  parse(text: string, homeCurrency: string): ParseResult {
    return parseTransactionsCsv(text, homeCurrency, "csv");
  },
};

export function monoProvider(): BankDataProvider {
  const key = process.env.NEXT_PUBLIC_MONO_PUBLIC_KEY;
  return {
    id: "mono",
    label: "Connect a Nigerian bank account (Mono)",
    available: false,
    status: key
      ? "Mono public key found, but the server-side token exchange is not implemented yet — account linking is disabled."
      : "Not configured. Add Mono credentials to enable account linking.",
  };
}
