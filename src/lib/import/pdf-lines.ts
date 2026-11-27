// Turns positioned text (from a digital PDF statement) into transaction rows.
// Bank layouts differ, so it combines several signals rather than assuming one
// format:
//   1. A header row ("Debit"/"Credit"/"Balance", "Withdrawals"/"Deposits", …)
//      gives column x-positions; amounts are assigned to the nearest column.
//   2. Without columns, a running balance decides direction
//      (previous − amount = current ⇒ money out).
//   3. CR/DR markers or signs on the amount.
// Anything still ambiguous is flagged for the user — never silently confirmed.
import { parseAmount, parseDate } from "../detection/csv.ts";
import { directionHint } from "./hints.ts";
import { ISSUE, type ExtractedRow } from "./types.ts";

export interface TextItem {
  str: string;
  x: number; // left edge
  w: number; // width
}
export interface TextLine {
  page: number;
  y: number;
  items: TextItem[];
}

/** Group pdf.js text items into lines (same baseline ±2pt), top to bottom. */
export function linesFromItems(page: number, items: { str: string; transform: number[]; width: number }[]): TextLine[] {
  const byY = new Map<number, TextLine>();
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5]);
    const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    const line = byY.get(key) ?? { page, y: key, items: [] };
    line.items.push({ str: it.str, x: it.transform[4], w: it.width });
    byY.set(key, line);
  }
  return [...byY.values()].sort((a, b) => b.y - a.y);
}

const DATE_RE =
  /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-,]+\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i;
// "5,000.00", "-₦5,000.00", "+20,000.00", "(1,200.00)", "1,200.00 CR", "N5,000", "5,000.00-"
const AMOUNT_RE = /^[-+(]?\s*(?:[₦$£€]|NGN|USD|N)?\s?[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})-?\)?\s?(?:CR|DR|Cr|Dr)?$/;
const MARKER_RE = /^(CR|DR|C|D)$/i;
// Something that was meant to be a date but can't be read ("3?-Oct-2026", "31/O9/2026").
const LOOSE_DATE_RE = /^[\d?]{1,2}\S?[-/. ](?:[a-z]{3,9}|[\dOo]{1,2})[-/. ][\dOo]{2,4}$/i;
const SKIP_RE = /(opening|closing|brought forward|carried forward|b\/f|c\/f|balance (?:as at|forward)|^total|subtotal|statement period)/i;

const HEADER_WORDS = {
  debit: /^(debits?|withdrawals?|money out|paid out|dr|debit amount|withdrawal amount|outflows?|out)$/i,
  credit: /^(credits?|deposits?|lodgements?|money in|paid in|cr|credit amount|deposit amount|inflows?|in)$/i,
  balance: /^(balance|running balance|closing balance|available balance|ledger balance|bal)$/i,
  amount: /^(amount|transaction amount|amt)$/i,
};
/** "Debit (₦)", "CREDIT(NGN)", "Balance NGN" → bare heading word. */
function headingWord(str: string) {
  return str.replace(/\s*\((?:₦|ngn|usd|\$|n)\)\s*$/i, "").replace(/\s+(?:₦|ngn|usd)$/i, "").trim();
}

type Col = "debit" | "credit" | "balance" | "amount";

function stripDates(str: string) {
  let t = str.trim();
  for (let i = 0; i < 3; i++) {
    const m = t.match(DATE_RE);
    if (!m || m.index !== 0) break;
    t = t.slice(m[0].length).trim();
  }
  return t;
}

function isHeaderLine(cs: TextItem[]) {
  return cs.filter((c) => Object.values(HEADER_WORDS).some((re) => re.test(headingWord(c.str)))).length >= 2;
}

function center(i: TextItem) {
  return i.x + i.w / 2;
}

/** Re-split a line into "cells": adjacent items closer than a gap are joined. */
function cells(line: TextLine): TextItem[] {
  const sorted = [...line.items].filter((i) => i.str.trim()).sort((a, b) => a.x - b.x);
  const out: TextItem[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    if (prev && it.x - (prev.x + prev.w) < 3) {
      prev.str = `${prev.str}${it.x - (prev.x + prev.w) > 0.8 ? " " : ""}${it.str}`;
      prev.w = it.x + it.w - prev.x;
    } else out.push({ ...it });
  }
  return out.flatMap(splitAmounts).map((c) => ({ ...c, str: c.str.trim() })).filter((c) => c.str);
}

/**
 * PDF generators often merge neighbouring cells into one text run
 * ("850,000.00 1,248,814.00" or "NETFLIX 5,000.00"). Peel trailing amount tokens
 * into their own cells, estimating each token's x from its character offset.
 */
function splitAmounts(c: TextItem): TextItem[] {
  const tokens = c.str.trim().split(/\s+/);
  if (tokens.length < 2) return [c];
  // Re-attach detached CR/DR markers to their amount.
  const merged: string[] = [];
  for (const t of tokens) {
    if (/^(CR|DR|Cr|Dr)$/.test(t) && merged.length && AMOUNT_RE.test(merged[merged.length - 1])) merged[merged.length - 1] += ` ${t}`;
    else merged.push(t);
  }
  let k = merged.length;
  while (k > 0 && AMOUNT_RE.test(merged[k - 1])) k--;
  if (k === merged.length) return [c];
  const cw = c.w / Math.max(1, c.str.length);
  const out: TextItem[] = [];
  let offset = 0;
  const head = merged.slice(0, k).join(" ");
  if (head) {
    out.push({ str: head, x: c.x, w: head.length * cw });
    offset = c.str.indexOf(merged[k], head.length);
  }
  for (const t of merged.slice(k)) {
    const at = c.str.indexOf(t, offset);
    out.push({ str: t, x: c.x + at * cw, w: t.length * cw });
    offset = at + t.length;
  }
  return out;
}

function findHeader(lines: TextLine[]): Partial<Record<Col, number>> | null {
  for (const line of lines) {
    const cols: Partial<Record<Col, number>> = {};
    for (const c of cells(line)) {
      for (const k of Object.keys(HEADER_WORDS) as Col[]) if (HEADER_WORDS[k].test(headingWord(c.str))) cols[k] = center(c);
    }
    if ((cols.debit !== undefined && cols.credit !== undefined) || (cols.amount !== undefined && (cols.balance !== undefined || /date/i.test(line.items.map((i) => i.str).join(" "))))) return cols;
  }
  return null;
}

function nearest(x: number, cols: Partial<Record<Col, number>>): Col | null {
  let best: Col | null = null;
  let d = Infinity;
  for (const [k, cx] of Object.entries(cols) as [Col, number][]) {
    const dist = Math.abs(cx - x);
    if (dist < d) {
      d = dist;
      best = k;
    }
  }
  return best;
}

function detectFormat(lines: TextLine[]): "dmy" | "mdy" | "iso" | "text" {
  let dmy = false;
  let mdy = false;
  for (const l of lines.slice(0, 400)) {
    const first = cells(l)[0]?.str ?? "";
    const m = first.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (m) {
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    }
  }
  return mdy && !dmy ? "mdy" : "dmy";
}

type Sign = -1 | 0 | 1;

/** Sign carried by the amount text itself: -1 minus/brackets/DR, +1 plus/CR, 0 none. */
function signOf(str: string): Sign {
  if (/^\(.*\)$/.test(str) || /^[^\d]*-/.test(str) || /-$/.test(str.trim()) || /\bDR\b/i.test(str)) return -1;
  if (/^[^\d]*\+/.test(str) || /\bCR\b/i.test(str)) return 1;
  return 0;
}

interface Draft {
  row: ExtractedRow;
  sign: Sign; // explicit sign on a single amount column (0 = none)
  balance?: number;
}

export function parseStatementLines(lines: TextLine[], homeCurrency: string): { rows: ExtractedRow[]; layout: string; warnings: string[] } {
  const header = findHeader(lines);
  const fmt = detectFormat(lines);
  const allText = lines.map((l) => l.items.map((i) => i.str).join(" ")).join("\n");
  const currency = /\bUSD\b|US\$/.test(allText) && !/\bNGN\b|₦/.test(allText) ? "USD" : homeCurrency;
  const twoColumns = !!header && header.debit !== undefined && header.credit !== undefined;
  const balanceRightmost = !!header && header.balance !== undefined && Object.values(header).every((x) => x! <= header.balance!);
  const drafts: Draft[] = [];
  let prevBalance: number | undefined;
  let current: ExtractedRow | null = null;
  // Text-only lines seen since the last row. Wrapped narrations can sit above
  // (vertically centred) or below the dated line, so we decide where they go
  // when the next dated row arrives.
  let pending: string[] = [];
  let n = 0;

  for (const line of lines) {
    const cs = cells(line);
    if (!cs.length) continue;
    const text = cs.map((c) => c.str).join(" ");
    const amountCells = cs.filter((c) => AMOUNT_RE.test(c.str));
    const firstWord = cs[0].str.split(/\s+/)[0];
    const looseDate = !DATE_RE.test(text) && amountCells.length && LOOSE_DATE_RE.test(firstWord) ? firstWord : null;
    const dateMatch: RegExpMatchArray | [string, string] | null = text.match(DATE_RE) ?? (looseDate ? [looseDate, looseDate] : null);

    if (!dateMatch || !amountCells.length) {
      if (header && !amountCells.length && !DATE_RE.test(text) && text.length < 120 && !SKIP_RE.test(text) && !isHeaderLine(cs)) pending.push(text);
      else if (!header && current && !amountCells.length && !DATE_RE.test(text) && text.length < 120 && !SKIP_RE.test(text)) current.description = `${current.description} ${text}`.trim();
      // Opening balance lines seed the running balance.
      if (SKIP_RE.test(text) && amountCells.length) prevBalance = parseAmount(amountCells[amountCells.length - 1].str)?.value;
      continue;
    }
    if (SKIP_RE.test(text)) {
      prevBalance = parseAmount(amountCells[amountCells.length - 1].str)?.value ?? prevBalance;
      continue;
    }

    const date = parseDate(dateMatch[1], fmt) ?? "";
    const markerCell = cs.find((c) => MARKER_RE.test(c.str) && !AMOUNT_RE.test(c.str));
    const marker: Sign = markerCell ? (/^c/i.test(markerCell.str) ? 1 : -1) : 0;
    // Description: non-amount, non-marker cells with leading transaction/value dates removed.
    let description = cs
      .filter((c) => !AMOUNT_RE.test(c.str) && c !== markerCell)
      .map((c) => stripDates(looseDate && c === cs[0] ? c.str.slice(looseDate.length) : c.str))
      .filter(Boolean)
      .join(" ");
    if (pending.length) {
      if (!description) description = pending.join(" ");
      else if (current) current.description = `${current.description} ${pending.join(" ")}`.trim();
      pending = [];
    }

    let amount = 0;
    let direction: ExtractedRow["direction"] = "debit";
    let from: ExtractedRow["directionFrom"];
    let balance: number | undefined;
    let sign: Sign = 0;

    if (header) {
      const amts = [...amountCells].sort((a, b) => a.x - b.x);
      // With a balance column on the right, the rightmost amount on a row is the balance:
      // more reliable than estimated positions when a PDF merges cells.
      if (balanceRightmost && amts.length >= 2) balance = parseAmount(amts.pop()!.str)?.value;
      const cols = { ...header };
      if (balanceRightmost && balance !== undefined) delete cols.balance;
      for (const c of amts) {
        const col = nearest(center(c), cols);
        const v = parseAmount(c.str)?.value;
        if (v === undefined) continue;
        if (col === "balance") balance = v;
        else if (col === "debit" && Math.abs(v) > 0) [amount, direction, from] = [Math.abs(v), "debit", "columns"];
        else if (col === "credit" && Math.abs(v) > 0) [amount, direction, from] = [Math.abs(v), "credit", "columns"];
        else if (col === "amount") {
          amount = Math.abs(v);
          sign = signOf(c.str);
        }
      }
    } else {
      const vals = amountCells.map((c) => ({ c, v: parseAmount(c.str)?.value ?? 0 }));
      if (vals.length >= 2) balance = vals[vals.length - 1].v;
      const main = vals.length >= 2 ? vals[vals.length - 2] : vals[0];
      amount = Math.abs(main.v);
      sign = signOf(main.c.str);
    }
    if (!from && marker) [direction, from] = [marker > 0 ? "credit" : "debit", "marker"];
    if (!from && sign) [direction, from] = [sign > 0 ? "credit" : "debit", "sign"];

    // The running balance is arithmetic, not layout: when it clearly says one way, it wins.
    if (balance !== undefined && prevBalance !== undefined && amount) {
      const out = Math.abs(prevBalance - amount - balance) < 0.011;
      const inn = Math.abs(prevBalance + amount - balance) < 0.011;
      // Keep the column/sign source when it agrees; credit the balance only when it decides or corrects.
      if (out !== inn && (!from || direction !== (out ? "debit" : "credit"))) [direction, from] = [out ? "debit" : "credit", "balance"];
    }
    if (balance !== undefined) prevBalance = balance;

    current = { id: `p${n++}`, date, description, amount, direction, currency, balance, issues: [], include: true, directionFrom: from, rawDate: date ? undefined : dateMatch[1] };
    drafts.push({ row: current, sign, balance });
  }
  if (current && pending.length) current.description = `${current.description} ${pending.join(" ")}`.trim();

  // Single signed amount column: if the statement marks money out with a minus sign,
  // an unmarked positive amount means money in. (Not applied to debit/credit layouts.)
  if (!twoColumns) {
    const minus = drafts.filter((d) => d.sign === -1).length;
    if (minus > 0) for (const d of drafts) if (!d.row.directionFrom && d.sign === 0 && d.row.amount) [d.row.direction, d.row.directionFrom] = ["credit", "sign"];
  }

  const rows = drafts.map((d) => d.row);
  for (const r of rows) {
    if (!r.amount) r.issues.push(ISSUE.amount);
    else if (!r.directionFrom) {
      r.issues.push(ISSUE.direction);
      r.hint = directionHint(r.description);
    }
    if (!r.date) r.issues.push(ISSUE.date);
    if (!r.description) r.issues.push(ISSUE.description);
    r.include = r.issues.length === 0;
  }

  const warnings: string[] = [];
  if (!rows.length) warnings.push("No transactions were recognised in this PDF.");
  return { rows, layout: twoColumns ? "separate money in and money out columns" : header ? "single amount column" : "running balance", warnings };
}
