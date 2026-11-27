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
import type { ExtractedRow } from "./types.ts";

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
const AMOUNT_RE = /^[-(]?\s*(?:[₦$£€]|NGN|USD)?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?\s?(?:CR|DR|Cr|Dr)?$/;
const SKIP_RE = /(opening|closing|brought forward|carried forward|b\/f|c\/f|balance (?:as at|forward)|^total|subtotal|statement period)/i;

const HEADER_WORDS = {
  debit: /^(debit|debits|withdrawals?|money out|paid out|dr|debit amount|outflow)$/i,
  credit: /^(credit|credits|deposits?|lodgements?|money in|paid in|cr|credit amount|inflow)$/i,
  balance: /^(balance|running balance|closing balance|bal)$/i,
  amount: /^(amount|transaction amount)$/i,
};

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
  return cs.some((c) => Object.values(HEADER_WORDS).some((re) => re.test(c.str)));
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
      for (const k of Object.keys(HEADER_WORDS) as Col[]) if (HEADER_WORDS[k].test(c.str)) cols[k] = center(c);
    }
    if ((cols.debit !== undefined && cols.credit !== undefined) || (cols.amount !== undefined && cols.balance !== undefined)) return cols;
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

export function parseStatementLines(lines: TextLine[], homeCurrency: string): { rows: ExtractedRow[]; layout: string; warnings: string[] } {
  const header = findHeader(lines);
  const fmt = detectFormat(lines);
  const allText = lines.map((l) => l.items.map((i) => i.str).join(" ")).join("\n");
  const currency = /\bUSD\b|US\$/.test(allText) && !/\bNGN\b|₦/.test(allText) ? "USD" : homeCurrency;
  const rows: ExtractedRow[] = [];
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
    const dateMatch = text.match(DATE_RE);
    const amountCells = cs.filter((c) => AMOUNT_RE.test(c.str));

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
    // Description: cells that are not dates or amounts (value-date column dropped).
    // Description: non-amount cells with leading transaction/value dates removed.
    let description = cs
      .filter((c) => !AMOUNT_RE.test(c.str))
      .map((c) => stripDates(c.str))
      .filter(Boolean)
      .join(" ");
    if (pending.length) {
      if (!description) description = pending.join(" ");
      else if (current) current.description = `${current.description} ${pending.join(" ")}`.trim();
      pending = [];
    }

    const issues: string[] = [];
    let amount = 0;
    let direction: ExtractedRow["direction"] = "debit";
    let balance: number | undefined;
    let decided = false;

    if (header) {
      for (const c of amountCells) {
        const col = nearest(center(c), header);
        const v = parseAmount(c.str)?.value;
        if (v === undefined) continue;
        if (col === "balance") balance = v;
        else if (col === "debit" && Math.abs(v) > 0) [amount, direction, decided] = [Math.abs(v), "debit", true];
        else if (col === "credit" && Math.abs(v) > 0) [amount, direction, decided] = [Math.abs(v), "credit", true];
        else if (col === "amount") {
          amount = Math.abs(v);
          if (v < 0 || /DR/i.test(c.str)) [direction, decided] = ["debit", true];
          else if (/CR/i.test(c.str)) [direction, decided] = ["credit", true];
        }
      }
    } else {
      const vals = amountCells.map((c) => ({ c, v: parseAmount(c.str)?.value ?? 0 }));
      if (vals.length >= 2) balance = vals[vals.length - 1].v;
      const main = vals.length >= 2 ? vals[vals.length - 2] : vals[0];
      amount = Math.abs(main.v);
      if (/DR/i.test(main.c.str) || main.v < 0) [direction, decided] = ["debit", true];
      else if (/CR/i.test(main.c.str)) [direction, decided] = ["credit", true];
    }
    // Running balance is the most reliable signal when present.
    if (!decided && balance !== undefined && prevBalance !== undefined && amount) {
      if (Math.abs(prevBalance - amount - balance) < 0.011) [direction, decided] = ["debit", true];
      else if (Math.abs(prevBalance + amount - balance) < 0.011) [direction, decided] = ["credit", true];
    }
    if (balance !== undefined) prevBalance = balance;
    if (!decided && amount) issues.push("Money in or out? Assumed money out");
    if (!date) issues.push(`Unreadable date “${dateMatch[1]}”`);
    if (!description) issues.push("No description");
    if (!amount) issues.push("No amount");

    current = { id: `p${n++}`, date, description, amount, direction, currency, balance, issues, include: issues.length === 0 };
    rows.push(current);
  }
  if (current && pending.length) current.description = `${current.description} ${pending.join(" ")}`.trim();
  // A description filled from a following line clears its "No description" issue.
  for (const r of rows) if (r.description && r.issues.includes("No description")) r.issues = r.issues.filter((i) => i !== "No description");
  for (const r of rows) r.include = r.issues.length === 0;

  const warnings: string[] = [];
  if (!rows.length) warnings.push("No transaction rows were recognised in this PDF.");
  const flagged = rows.filter((r) => r.issues.length).length;
  if (flagged) warnings.push(`${flagged} rows need your review before they’re used.`);
  return { rows, layout: header ? "column layout" : "running-balance layout", warnings };
}
