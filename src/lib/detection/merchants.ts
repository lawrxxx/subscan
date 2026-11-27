// Merchant normalisation + a small directory of well-known recurring merchants.
// The directory only improves display names / categories and nudges confidence;
// detection itself is driven by observed billing patterns.

import type { BillType, ObligationKind } from "../types.ts";

export interface KnownMerchant {
  key: string;
  name: string;
  category: string;
  patterns: RegExp[];
  kind?: ObligationKind; // default "subscription"
  billType?: BillType; // default "fixed"
  /** Bought ad hoc (e.g. prepaid electricity tokens) rather than billed on a schedule. */
  prepaid?: boolean;
  /** Category keyword rather than a named provider: name and group by the narration instead. */
  generic?: boolean;
}

export const KNOWN_MERCHANTS: KnownMerchant[] = [
  { key: "netflix", name: "Netflix", category: "Streaming", patterns: [/netflix/] },
  { key: "spotify", name: "Spotify", category: "Music", patterns: [/spotify/] },
  { key: "apple", name: "Apple Services", category: "Digital services", patterns: [/apple\.com\/bill|itunes|apple services|icloud/] },
  { key: "youtube", name: "YouTube Premium", category: "Streaming", patterns: [/youtube|google \*youtube/] },
  { key: "google-one", name: "Google One", category: "Digital services", patterns: [/google \*?one|google storage/] },
  { key: "amazon-prime", name: "Amazon Prime", category: "Streaming", patterns: [/prime video|amazon prime|amzn prime/] },
  { key: "showmax", name: "Showmax", category: "Streaming", patterns: [/showmax/] },
  { key: "dstv", name: "DStv", category: "TV", patterns: [/dstv|multichoice/] },
  { key: "gotv", name: "GOtv", category: "TV", patterns: [/gotv/] },
  { key: "openai", name: "ChatGPT Plus", category: "Software", patterns: [/openai|chatgpt/] },
  { key: "anthropic", name: "Claude Pro", category: "Software", patterns: [/anthropic|claude\.ai/] },
  { key: "notion", name: "Notion", category: "Software", patterns: [/notion/] },
  { key: "figma", name: "Figma", category: "Software", patterns: [/figma/] },
  { key: "adobe", name: "Adobe Creative Cloud", category: "Software", patterns: [/adobe/] },
  { key: "canva", name: "Canva", category: "Software", patterns: [/canva/] },
  { key: "dropbox", name: "Dropbox", category: "Digital services", patterns: [/dropbox/] },
  { key: "microsoft", name: "Microsoft 365", category: "Software", patterns: [/microsoft|msft|office 365/] },
  { key: "linkedin", name: "LinkedIn Premium", category: "Software", patterns: [/linkedin/] },
  { key: "audiomack", name: "Audiomack", category: "Music", patterns: [/audiomack/] },
  { key: "boomplay", name: "Boomplay", category: "Music", patterns: [/boomplay/] },
  { key: "apple-music", name: "Apple Music", category: "Music", patterns: [/apple music/] },
  // Utilities -------------------------------------------------------------
  { key: "mtn-data", name: "MTN Data Plan", category: "Mobile", kind: "utility", patterns: [/mtn.*(data|bundle|postpaid)|mtn ng/] },
  { key: "airtel-data", name: "Airtel Data Plan", category: "Mobile", kind: "utility", patterns: [/airtel/] },
  { key: "glo", name: "Glo Mobile", category: "Mobile", kind: "utility", patterns: [/\bglo\b.*(data|bundle|airtime)|globacom/] },
  { key: "9mobile", name: "9mobile", category: "Mobile", kind: "utility", patterns: [/9mobile/] },
  { key: "starlink", name: "Starlink", category: "Internet", kind: "utility", patterns: [/starlink/] },
  { key: "spectranet", name: "Spectranet", category: "Internet", kind: "utility", patterns: [/spectranet/] },
  { key: "smile", name: "Smile Internet", category: "Internet", kind: "utility", patterns: [/smile (comm|4g|data|internet)/] },
  { key: "ipnx", name: "ipNX", category: "Internet", kind: "utility", patterns: [/ipnx/] },
  { key: "tizeti", name: "Tizeti / Wifi.com.ng", category: "Internet", kind: "utility", patterns: [/tizeti|wifi\.com\.ng/] },
  { key: "fibreone", name: "FibreOne", category: "Internet", kind: "utility", patterns: [/fibre ?one/] },
  { key: "ikedc", name: "Ikeja Electric", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/ikedc|ikeja electric/] },
  { key: "ekedc", name: "Eko Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/ekedc|eko electric/] },
  { key: "aedc", name: "Abuja Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/aedc|abuja electric/] },
  { key: "phed", name: "Port Harcourt Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/\bphed\b|port harcourt electric/] },
  { key: "ibedc", name: "Ibadan Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/ibedc|ibadan electric/] },
  { key: "kedco", name: "Kano Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/kedco|kano electric/] },
  { key: "eedc", name: "Enugu Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/\beedc\b|enugu electric/] },
  { key: "electricity", generic: true, name: "Electricity", category: "Electricity", kind: "utility", billType: "variable", prepaid: true, patterns: [/electricity|prepaid (meter|token)|power token/] },
  { key: "water", generic: true, name: "Water", category: "Water", kind: "utility", billType: "variable", patterns: [/water (corp|board|bill)|lswc/] },
  { key: "lawma", name: "LAWMA (waste)", category: "Waste", kind: "utility", patterns: [/lawma|waste management/] },
  // Other recurring obligations ------------------------------------------------
  { key: "rent", generic: true, name: "Rent", category: "Rent", kind: "obligation", patterns: [/\brent\b|landlord|house rent/] },
  { key: "insurance", generic: true, name: "Insurance", category: "Insurance", kind: "obligation", patterns: [/insurance|axa mansard|leadway|aiico|\bhmo\b|hygeia|reliance health|cornerstone ins/] },
  { key: "loan", generic: true, name: "Loan repayment", category: "Loan", kind: "obligation", patterns: [/loan|repayment|fairmoney|renmoney|carbon|palmcredit|branch intl/] },
  { key: "school", generic: true, name: "School fees", category: "Education", kind: "obligation", billType: "variable", patterns: [/school fees|tuition|\bschool\b|college fees/] },
  { key: "savings", generic: true, name: "Savings plan", category: "Savings", kind: "obligation", patterns: [/piggyvest|cowrywise|savings plan|target savings/] },
  { key: "github", name: "GitHub", category: "Software", patterns: [/github/] },
  { key: "duolingo", name: "Duolingo", category: "Education", patterns: [/duolingo/] },
  { key: "coursera", name: "Coursera", category: "Education", patterns: [/coursera/] },
  { key: "gym", name: "Gym membership", category: "Memberships", patterns: [/fitness|gym\b|i-fitness|bodyline/] },
];

const NOISE = [
  /\b(pos|web|purchase|payment|pymt|trf|transfer|debit|card|visa|mastercard|verve|nip|ussd|online|recurring|txn|ref|pmt)\b/g,
  /\b\d{4,}\b/g, // card digits / refs
  /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, // inline dates
  /[*#:|_]+/g,
  /\b(ng|lagos|lag|abuja|ie|gb|us|irl|ca|com|www)\b/g,
];

export function normaliseDescription(raw: string): string {
  let s = raw.toLowerCase();
  for (const re of NOISE) s = s.replace(re, " ");
  return s.replace(/[^a-z0-9.& ]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchKnown(raw: string): KnownMerchant | undefined {
  const s = raw.toLowerCase();
  return KNOWN_MERCHANTS.find((m) => m.patterns.some((p) => p.test(s)));
}

/** Stable merchant key used to group transactions. */
const FILLER = new Set(["to", "from", "for", "the", "mr", "mrs", "ms", "dr", "via", "and", "of"]);

export function merchantKey(raw: string): string {
  const known = matchKnown(raw);
  if (known && !known.generic) return known.key;
  const words = normaliseDescription(raw).split(" ").filter((w) => w.length > 1 && !FILLER.has(w));
  return words.slice(0, 2).join("-") || "unknown";
}

export function merchantLabel(raw: string): string {
  const known = matchKnown(raw);
  if (known && !known.generic) return known.name;
  const words = normaliseDescription(raw).split(" ").filter((w) => w.length > 1 && !FILLER.has(w)).slice(0, 3);
  if (!words.length) return raw.trim().slice(0, 32);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function merchantCategory(raw: string): string {
  return matchKnown(raw)?.category ?? "Other";
}

export const KIND_LABEL: Record<ObligationKind, string> = { subscription: "Subscription", utility: "Utility", obligation: "Other obligation" };
export const KIND_PLURAL: Record<ObligationKind, string> = { subscription: "Subscriptions", utility: "Utilities", obligation: "Other obligations" };

export const CATEGORIES: Record<ObligationKind, string[]> = {
  subscription: ["Streaming", "Music", "Software", "TV", "Memberships", "Digital services", "Education", "Other"],
  utility: ["Electricity", "Internet", "Mobile", "Water", "Waste", "Other"],
  obligation: ["Rent", "Insurance", "Loan", "Education", "Savings", "Other"],
};

/** Classify a narration into kind / category / bill type (unknown ⇒ subscription, Other). */
export function classify(raw: string): { kind: ObligationKind; category: string; billType: BillType; prepaid: boolean; known?: KnownMerchant } {
  const known = matchKnown(raw);
  return { kind: known?.kind ?? "subscription", category: known?.category ?? "Other", billType: known?.billType ?? "fixed", prepaid: !!known?.prepaid, known };
}

export const SUBSCRIPTION_HINTS = /(subscription|subscr|renewal|renew|membership|monthly|annual|yearly|plan|premium|pro\b|plus\b|bill)/i;
