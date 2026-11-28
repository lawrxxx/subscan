import { test } from "node:test";
import assert from "node:assert/strict";
import { datesBetween, describe, nextDate, nth } from "../src/lib/money/schedule.ts";
import { evaluateRule, transferCap } from "../src/lib/money/rules.ts";
import { plan, ruleKey, scheduleKey, upcoming, GRACE_DAYS } from "../src/lib/money/plan.ts";
import type { AppState, MoneyRule, Recipient, TransferSchedule, Activity } from "../src/lib/types.ts";

const T = "2026-11-01T00:00:00.000Z";
const mum: Recipient = { id: "r1", name: "Mum", address: "0x1111111111111111111111111111111111111111", createdAt: T, confirmedAt: T };
const sched = (p: Partial<TransferSchedule> = {}): TransferSchedule => ({ id: "s1", recipientId: "r1", token: "cNGN", amount: "5000", frequency: "monthly", firstDate: "2026-11-01", status: "active", createdAt: T, updatedAt: T, ...p });
const rule = (p: Partial<MoneyRule>): MoneyRule => ({ id: "x1", name: "r", kind: "keep_min", token: "cNGN", amount: "50000", status: "active", createdAt: T, updatedAt: T, ...p });
const state = (p: Partial<AppState> = {}): AppState => ({ version: 2, settings: { payGasInUsdt: false }, recipients: [mum], rules: [], schedules: [], activity: [], ...p });
const act = (p: Partial<Activity>): Activity => ({ id: "a" + Math.random(), kind: "transfer", status: "completed", createdAt: T, updatedAt: T, key: "k", token: "cNGN", amount: "5000", ...p });
const NOW = Date.parse("2026-12-01T10:00:00Z");

test("monthly dates keep the day and clamp to the month's end", () => {
  assert.deepEqual([0, 1, 2, 3].map((k) => nth({ frequency: "monthly", firstDate: "2026-01-31" }, k)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(datesBetween({ frequency: "weekly", firstDate: "2026-11-06" }, "2026-11-01", "2026-11-30"), ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  assert.equal(nextDate({ frequency: "monthly", firstDate: "2026-11-01", endDate: "2026-12-15" }, "2026-12-02"), null);
  assert.equal(nextDate({ frequency: "once", firstDate: "2026-12-05" }, "2026-12-01"), "2026-12-05");
  assert.equal(describe({ frequency: "monthly", firstDate: "2026-12-01" }), "On the 1st of every month");
});

test("a due transfer is sent once, and never again after it's recorded", () => {
  const s = state({ schedules: [sched()] });
  const steps = plan(s, { today: "2026-12-01", nowMs: NOW, balances: null, ngnPerUsd: null });
  // 1 Nov is 30 days late (asks), 1 Dec is today (sends).
  assert.deepEqual(steps.map((x) => x.type), ["ask", "send"]);
  const done = state({ schedules: [sched()], activity: [act({ key: scheduleKey("s1", "2026-11-01"), scheduleId: "s1" }), act({ key: scheduleKey("s1", "2026-12-01"), scheduleId: "s1" })] });
  assert.deepEqual(plan(done, { today: "2026-12-01", nowMs: NOW, balances: null, ngnPerUsd: null }), []);
});

test(`late by up to ${GRACE_DAYS} days still sends; later waits for approval`, () => {
  const s = state({ schedules: [sched({ firstDate: "2026-11-28", frequency: "once" })] });
  assert.equal(plan(s, { today: "2026-12-01", nowMs: NOW, balances: null, ngnPerUsd: null })[0].type, "send");
  assert.equal(plan(s, { today: "2026-12-02", nowMs: NOW, balances: null, ngnPerUsd: null })[0].type, "ask");
});

test("paused, unconfirmed recipient, per-transfer limit, money-rule cap, max total", () => {
  const opts = { today: "2026-12-01", nowMs: NOW, balances: null, ngnPerUsd: null };
  const one = sched({ firstDate: "2026-12-01" });
  assert.deepEqual(plan(state({ schedules: [{ ...one, status: "paused" }] }), opts), []);
  assert.equal(plan(state({ schedules: [one], recipients: [{ ...mum, confirmedAt: undefined }] }), opts)[0].type, "block");
  assert.equal(plan(state({ schedules: [{ ...one, txLimit: "4000" }] }), opts)[0].type, "block");
  const capped = plan(state({ schedules: [one], rules: [rule({ kind: "transfer_cap", amount: "3000" })] }), opts)[0];
  assert.equal(capped.type, "block");
  const total = plan(state({ schedules: [{ ...one, firstDate: "2026-11-01", maxTotal: "7000" }], activity: [act({ key: scheduleKey("s1", "2026-11-01"), scheduleId: "s1" })] }), opts)[0];
  assert.equal(total.type, "block");
  assert.equal(total.type === "block" && total.end, true);
});

test("rules: keep a minimum, convert when low, keep a share, cap", () => {
  const bal = { USDT: 100, cNGN: 20000 };
  const keep = evaluateRule(rule({ kind: "keep_min", amount: "50000", maxAmount: "15" }), bal, 1450);
  assert.equal(keep.kind, "convert");
  assert.equal(keep.kind === "convert" && keep.buyAmount, 30000);
  assert.equal(keep.kind === "convert" && keep.maxSell, 15);
  assert.equal(evaluateRule(rule({ kind: "keep_min", amount: "10000" }), bal, 1450).kind, "none");
  const low = evaluateRule(rule({ kind: "convert_below", amount: "30000", convertAmount: "20" }), bal, null);
  assert.equal(low.kind === "convert" && low.sellAmount, 20);
  // 100 USD₮ + 20,000 cNGN (≈13.79 USD₮) at 1,450 → USD₮ is ~88%; asking for 30% cNGN needs a conversion.
  const share = evaluateRule(rule({ kind: "reserve_share", token: "cNGN", sharePct: 30 }), bal, 1450);
  assert.equal(share.kind, "convert");
  assert.equal(evaluateRule(rule({ kind: "reserve_share", token: "cNGN", sharePct: 30 }), bal, null).kind, "wait");
  assert.equal(evaluateRule(rule({ kind: "keep_min", status: "paused" }), bal, 1450).kind, "none");
  assert.equal(transferCap([rule({ kind: "transfer_cap", amount: "5000" }), rule({ kind: "transfer_cap", amount: "3000" })], "cNGN"), 3000);
});

test("a rule converts at most once per window and never stacks", () => {
  const r = rule({ kind: "keep_min", amount: "50000" });
  const opts = { today: "2026-12-01", nowMs: NOW, balances: { USDT: 100, cNGN: 0 }, ngnPerUsd: 1450 };
  assert.equal(plan(state({ rules: [r] }), opts)[0].type, "convert");
  assert.equal(plan(state({ rules: [{ ...r, askFirst: true }] }), opts)[0].type, "ask_convert");
  assert.deepEqual(plan(state({ rules: [r], activity: [act({ key: ruleKey("x1", NOW), ruleId: "x1", kind: "conversion", status: "failed" })] }), opts), []);
  assert.deepEqual(plan(state({ rules: [r], activity: [act({ key: "old", ruleId: "x1", kind: "conversion", status: "processing" })] }), opts), []);
});

test("upcoming lists the next dates of live schedules, soonest first", () => {
  const u = upcoming(state({ schedules: [sched({ firstDate: "2026-12-05" }), sched({ id: "s2", frequency: "weekly", firstDate: "2026-12-03", amount: "20", token: "USDT" })] }), "2026-12-01", 3);
  assert.deepEqual(u.map((x) => x.date), ["2026-12-03", "2026-12-05", "2026-12-10"]);
});
