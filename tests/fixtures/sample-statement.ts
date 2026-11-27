// Generates a SAMPLE bank statement relative to today so the demo never goes
// stale. It is always labelled as sample data in the UI.

const DAY = 86_400_000;

function iso(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

interface Recurring {
  desc: string;
  amount: number | ((i: number) => number);
  currency: string;
  everyDays?: number;
  monthlyDay?: number;
  months?: number; // how many periods back
  yearly?: boolean;
  startOffsetMonths?: number;
  stopsMonthsAgo?: number;
}

const RECURRING: Recurring[] = [
  { desc: "NETFLIX.COM LAGOS NG", amount: (i) => (i < 4 ? 5000 : 4400), currency: "NGN", monthlyDay: 3, months: 12 },
  { desc: "POS PURCHASE SPOTIFY P1A2B3", amount: 1300, currency: "NGN", monthlyDay: 9, months: 12 },
  { desc: "MULTICHOICE DSTV COMPACT RENEWAL", amount: (i) => (i < 6 ? 19000 : 15700), currency: "NGN", monthlyDay: 14, months: 12 },
  { desc: "MTN NG DATA BUNDLE 25GB", amount: 6500, currency: "NGN", monthlyDay: 21, months: 12 },
  { desc: "SHOWMAX SUBSCRIPTION", amount: 2900, currency: "NGN", monthlyDay: 6, months: 8 },
  { desc: "GOOGLE *YOUTUBE PREMIUM", amount: 1100, currency: "NGN", monthlyDay: 27, months: 10 },
  { desc: "AUDIOMACK PREMIUM PLAN", amount: 900, currency: "NGN", monthlyDay: 17, months: 9 },
  { desc: "I-FITNESS IKOYI MEMBERSHIP", amount: 25000, currency: "NGN", monthlyDay: 1, months: 7, stopsMonthsAgo: 3 },
  { desc: "OPENAI *CHATGPT SUBSCR", amount: 20, currency: "USD", monthlyDay: 11, months: 12 },
  { desc: "NOTION LABS INC", amount: (i) => (i < 3 ? 12 : 10), currency: "USD", monthlyDay: 24, months: 12 },
  { desc: "APPLE.COM/BILL ICLOUD 200GB", amount: 2.99, currency: "USD", monthlyDay: 19, months: 12 },
  { desc: "CANVA PRO ANNUAL", amount: 119.99, currency: "USD", yearly: true, months: 2, startOffsetMonths: 1 },
  { desc: "SPECTRANET 4G LTE RENEWAL", amount: 18500, currency: "NGN", monthlyDay: 2, months: 12 },
  { desc: "AXA MANSARD HMO PREMIUM", amount: 12000, currency: "NGN", monthlyDay: 28, months: 12 },
  { desc: "FAIRMONEY LOAN REPAYMENT", amount: 45000, currency: "NGN", monthlyDay: 15, months: 6 },
  { desc: "LAWMA WASTE BILL", amount: 2500, currency: "NGN", monthlyDay: 10, months: 12 },
];

const NOISE = [
  ["SHOPRITE LEKKI", 8000, 42000],
  ["BOLT RIDE", 1800, 6500],
  ["CHICKEN REPUBLIC", 2500, 9000],
  ["NIP TRF TO ADEBAYO O", 5000, 60000],
  ["JUMIA NG ORDER", 4000, 55000],
  ["IKEDC PREPAID TOKEN", 10000, 30000],
  ["UBER TRIP", 2200, 7000],
  ["CAFE NEO", 3000, 7500],
] as const;

export function sampleStatementCsv(today = new Date()): string {
  const rand = rng(42);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const rows: { date: string; desc: string; debit?: number; credit?: number; currency: string }[] = [];

  // Rent, paid quarterly.
  for (let q = 0; q < 4; q++) {
    const d = new Date(end);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1 - q * 3);
    rows.push({ date: iso(d.getTime()), desc: "TRF TO MR ADEYEMI RENT", debit: 250000, currency: "NGN" });
  }
  for (const r of RECURRING) {
    const periods = r.months ?? 12;
    for (let i = 0; i < periods; i++) {
      const monthsBack = (r.yearly ? i * 12 : i) + (r.startOffsetMonths ?? 0) + (r.stopsMonthsAgo ?? 0);
      const d = new Date(end);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - monthsBack);
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(r.monthlyDay ?? 1, lastDay));
      if (d.getTime() > end) continue;
      const amount = typeof r.amount === "function" ? r.amount(i) : r.amount;
      rows.push({ date: iso(d.getTime()), desc: r.desc, debit: amount, currency: r.currency });
    }
  }
  for (let t = end - 365 * DAY; t <= end; t += DAY) {
    if (rand() < 0.45) {
      const [desc, lo, hi] = NOISE[Math.floor(rand() * NOISE.length)];
      rows.push({ date: iso(t), desc, debit: Math.round(lo + rand() * (hi - lo)), currency: "NGN" });
    }
    const d = new Date(t);
    if (d.getUTCDate() === 25) rows.push({ date: iso(t), desc: "SALARY CREDIT ACME LTD", credit: 850000, currency: "NGN" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const header = "Date,Narration,Debit,Credit,Currency";
  const body = rows.map((r) => `${r.date},"${r.desc}",${r.debit ?? ""},${r.credit ?? ""},${r.currency}`);
  return [header, ...body].join("\n");
}
