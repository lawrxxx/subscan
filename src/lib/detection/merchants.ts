// Merchant normalisation + a small directory of well-known recurring merchants.
// The directory only improves display names / categories and nudges confidence;
// detection itself is driven by observed billing patterns.

export interface KnownMerchant {
  key: string;
  name: string;
  category: string;
  patterns: RegExp[];
}

export const KNOWN_MERCHANTS: KnownMerchant[] = [
  { key: "netflix", name: "Netflix", category: "Streaming", patterns: [/netflix/] },
  { key: "spotify", name: "Spotify", category: "Music", patterns: [/spotify/] },
  { key: "apple", name: "Apple Services", category: "Cloud & apps", patterns: [/apple\.com\/bill|itunes|apple services|icloud/] },
  { key: "youtube", name: "YouTube Premium", category: "Streaming", patterns: [/youtube|google \*youtube/] },
  { key: "google-one", name: "Google One", category: "Cloud & apps", patterns: [/google \*?one|google storage/] },
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
  { key: "dropbox", name: "Dropbox", category: "Cloud & apps", patterns: [/dropbox/] },
  { key: "microsoft", name: "Microsoft 365", category: "Software", patterns: [/microsoft|msft|office 365/] },
  { key: "linkedin", name: "LinkedIn Premium", category: "Software", patterns: [/linkedin/] },
  { key: "audiomack", name: "Audiomack", category: "Music", patterns: [/audiomack/] },
  { key: "boomplay", name: "Boomplay", category: "Music", patterns: [/boomplay/] },
  { key: "apple-music", name: "Apple Music", category: "Music", patterns: [/apple music/] },
  { key: "mtn-data", name: "MTN Data Plan", category: "Telecoms", patterns: [/mtn.*(data|bundle)|mtn ng/] },
  { key: "airtel-data", name: "Airtel Data Plan", category: "Telecoms", patterns: [/airtel/] },
  { key: "starlink", name: "Starlink", category: "Internet", patterns: [/starlink/] },
  { key: "github", name: "GitHub", category: "Software", patterns: [/github/] },
  { key: "duolingo", name: "Duolingo", category: "Education", patterns: [/duolingo/] },
  { key: "coursera", name: "Coursera", category: "Education", patterns: [/coursera/] },
  { key: "gym", name: "Gym membership", category: "Fitness", patterns: [/fitness|gym\b|i-fitness|bodyline/] },
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
export function merchantKey(raw: string): string {
  const known = matchKnown(raw);
  if (known) return known.key;
  const words = normaliseDescription(raw).split(" ").filter((w) => w.length > 1);
  return words.slice(0, 2).join("-") || "unknown";
}

export function merchantLabel(raw: string): string {
  const known = matchKnown(raw);
  if (known) return known.name;
  const words = normaliseDescription(raw).split(" ").filter((w) => w.length > 1).slice(0, 3);
  if (!words.length) return raw.trim().slice(0, 32);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function merchantCategory(raw: string): string {
  return matchKnown(raw)?.category ?? "Other";
}

export const SUBSCRIPTION_HINTS = /(subscription|subscr|renewal|renew|membership|monthly|annual|yearly|plan|premium|pro\b|plus\b|bill)/i;
