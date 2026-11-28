import { test } from "node:test";
import assert from "node:assert/strict";
import { addressProblem, DESTINATIONS, tokensFor, WARNING } from "../src/lib/money/destinations.ts";
import { plan, scheduleKey } from "../src/lib/money/plan.ts";
import type { AppState } from "../src/lib/types.ts";

const by = (id: string) => DESTINATIONS.find((d) => d.id === id)!;

test("Quidax: USD₮ on Celo only, never cNGN", () => {
  assert.deepEqual(by("quidax").tokens, ["USDT"]);
  assert.match(by("quidax").steps.join(" "), /Deposits.*USDT.*Celo as the network.*paste/);
});
test("MiniPay: USD₮ only; Busha: not offered on Celo; another Celo wallet: both", () => {
  assert.deepEqual(by("minipay").tokens, ["USDT"]);
  assert.deepEqual(by("busha").tokens, []);
  assert.ok(by("busha").unavailable);
  assert.deepEqual(by("celo_wallet").tokens, ["USDT", "cNGN"]);
  assert.match(WARNING, /permanent loss/);
});
test("older recipients count as another Celo wallet; saved tokens win", () => {
  assert.deepEqual(tokensFor({}), ["USDT", "cNGN"]);
  assert.deepEqual(tokensFor({ destination: "quidax", tokens: ["USDT"] }), ["USDT"]);
});
test("addresses are checked, never changed", () => {
  const good = "0x044d4b5c1a7b247d9c03e192e88c91d260f669c8";
  assert.equal(addressProblem(good, []), null);
  assert.equal(addressProblem("0x044d4b5C1a7B247d9C03e192e88c91d260f669c8", []), null, "valid checksum");
  assert.match(addressProblem("0x044D4b5C1a7B247d9C03e192e88c91d260f669c8", [])!, /typo/, "bad checksum");
  assert.match(addressProblem(` ${good}`, [])!, /spaces/);
  assert.match(addressProblem("0x1234", [])!, /isn't a valid/);
  assert.match(addressProblem(good, [{ address: good.toUpperCase().replace("0X", "0x") as `0x${string}` }])!, /already saved/);
});
test("the planner blocks a token the recipient's destination doesn't accept", () => {
  const T = "2026-11-01T00:00:00Z";
  const s: AppState = { version: 2, settings: { payGasInUsdt: false }, rules: [], activity: [],
    recipients: [{ id: "r1", name: "Ada", address: "0x044d4b5c1a7b247d9c03e192e88c91d260f669c8", createdAt: T, confirmedAt: T, destination: "quidax", tokens: ["USDT"] }],
    schedules: [{ id: "s1", recipientId: "r1", token: "cNGN", amount: "5000", frequency: "once", firstDate: "2026-12-01", status: "active", createdAt: T, updatedAt: T }] };
  const st = plan(s, { today: "2026-12-01", nowMs: Date.parse("2026-12-01T10:00:00Z"), balances: null, ngnPerUsd: null });
  assert.equal(st[0].type, "block");
  assert.equal(st[0].type === "block" && st[0].key, scheduleKey("s1", "2026-12-01"));
});
