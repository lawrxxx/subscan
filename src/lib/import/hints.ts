// Wording-based guesses for money in / money out. Only ever shown as a suggestion
// for rows whose direction the statement itself doesn't make clear.
const IN = /\b(trf|transfer|nip|ft)?\s*(from|frm)\b|\b(inward|received|receive|deposit|lodgement|salary|payroll|refund|reversal|reversed|cashback|interest paid|credit alert|incoming)\b/i;
const OUT = /\b(pos|web|purchase|payment to|trf to|transfer to|to\s+[a-z]|airtime|data|bill|charge|fee|vat|levy|stamp duty|withdrawal|atm|debit card|subscription)\b/i;

export function directionHint(description: string): "credit" | "debit" | undefined {
  const inn = IN.test(description);
  const out = OUT.test(description);
  if (inn && !out) return "credit";
  if (out && !inn) return "debit";
  return undefined;
}
