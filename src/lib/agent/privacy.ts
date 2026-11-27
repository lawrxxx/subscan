// Redaction applied to every tool result before it is sent to the model.
// Statements are parsed in the browser; only structured tool output (dates,
// amounts, payee names, short descriptions) ever reaches Gemini, and even that
// is scrubbed of account numbers, card numbers, references and contact details.

const TEXT_KEYS = new Set(["description", "name", "payee", "merchant", "reason", "note", "label", "category", "display_name"]);
// Keys whose values are identifiers needed for links/status lookups, never free text.
const KEEP_KEYS = new Set(["id", "hash", "tx", "address", "recipient", "review_url", "from", "to", "date", "next_renewal", "last_charge", "rfq_id"]);

export function redactText(s: string): string {
  return (
    s
      // card numbers: 4-4-4-4 groups, or masked forms like 5399********1234
      .replace(/\b(?:\d{4}[ -]?){3}\d{1,4}\b/g, "[card]")
      .replace(/\b\d{4,6}[*xX•]{4,}\d{2,4}\b/g, "[card]")
      // e-mail and phone numbers
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
      .replace(/(?:\+?234|\b0)[789][01]\d{8}\b/g, "[phone]")
      // account numbers, session ids, transfer references: any run of 6+ digits
      .replace(/\d{6,}/g, "[ref]")
      // long alphanumeric references (e.g. FT23109ABCD12)
      .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{12,}\b/g, "[ref]")
  );
}

/** Deep-copies a tool result, redacting free-text fields. */
export function redact<T>(value: T, key = ""): T {
  if (typeof value === "string") return (KEEP_KEYS.has(key) || !TEXT_KEYS.has(key) ? value : redactText(value)) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, key)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out as T;
  }
  return value;
}
