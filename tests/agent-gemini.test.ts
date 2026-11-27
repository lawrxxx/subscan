// Exercises the Gemini agent loop end to end against a local mock of the
// generateContent endpoint, using the real SDK, the real tools and real
// detection output. Verifies: tools are declared, function calls run the app's
// own tools, results go back to the model redacted, and the final answer
// carries evidence. Also checks error mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleGenAI } from "@google/genai";
import { describeError, runGemini } from "../src/lib/agent/run.ts";
import { detectSubscriptions } from "../src/lib/detection/engine.ts";
import { parseTransactionsCsv } from "../src/lib/detection/csv.ts";
import { sampleStatementCsv } from "./fixtures/sample-statement.ts";
import type { AppState } from "../src/lib/types.ts";

const today = new Date().toISOString().slice(0, 10);

function state(): AppState {
  const txs = parseTransactionsCsv(sampleStatementCsv(), "NGN").transactions;
  txs.push({ id: "x-1", date: today, description: "TRF TO ZUBAIRU 0123456789 REF FT23109ABCD12", merchant: "trf-to-zubairu", amount: 5000, currency: "NGN", direction: "debit", source: "csv" });
  return { transactions: txs, subscriptions: detectSubscriptions(txs, { homeCurrency: "NGN", today }), payments: [], settings: { homeCurrency: "NGN", payGasInUsdt: false } };
}

type Handler = (body: any, n: number) => { status?: number; json: unknown };
async function mock(handler: Handler) {
  const bodies: any[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      bodies.push(body);
      const { status = 200, json } = handler(body, bodies.length);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const ai = new GoogleGenAI({ apiKey: "test-key", httpOptions: { baseUrl: `http://127.0.0.1:${port}` } });
  return { ai, bodies, close: () => server.close() };
}

const call = (name: string, args: Record<string, unknown>, id = "c1") => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { id, name, args } }] }, finishReason: "STOP" }] });
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }] });

test("model calls upcoming_renewals; tool runs on real data; answer carries evidence", async () => {
  const s = state();
  const m = await mock((body, n) => {
    if (n === 1) return { json: call("upcoming_renewals", { within_days: 30 }) };
    const fr = body.contents.at(-1).parts[0].functionResponse;
    const names = fr.response.output.renewals.map((r: any) => r.name).join(", ");
    return { json: text(`Coming up: ${names}`) };
  });
  try {
    const reply = await runGemini([{ role: "user", content: "What's due this month?" }], { state: s, rates: {}, today }, m.ai);
    // Tools were declared with JSON schemas
    const decl = m.bodies[0].tools[0].functionDeclarations.map((d: any) => d.name);
    for (const t of ["list_subscriptions", "upcoming_renewals", "spending_analysis", "find_waste", "prepare_payment", "transaction_status", "search_transactions"]) assert.ok(decl.includes(t), t);
    assert.ok(m.bodies[0].systemInstruction, "system instruction sent");
    // The tool ran over real detected bills
    assert.equal(reply.trace[0].name, "upcoming_renewals");
    const expected = (reply.trace[0].result as any).renewals.map((r: any) => r.name);
    assert.ok(expected.length > 0);
    assert.equal(reply.text, `Coming up: ${expected.join(", ")}`);
    assert.ok(reply.evidence.bills.length > 0 && reply.evidence.bills.every((b) => s.subscriptions.some((x) => x.id === b.id)));
    assert.equal(reply.mode, "gemini");
  } finally {
    m.close();
  }
});

test("transaction search results reach the model redacted, never the raw statement", async () => {
  const m = await mock((_b, n) => (n === 1 ? { json: call("search_transactions", { query: "zubairu" }) } : { json: text("Found it.") }));
  try {
    const reply = await runGemini([{ role: "user", content: "When did I pay Zubairu?" }], { state: state(), rates: {}, today }, m.ai);
    const sent = JSON.stringify(m.bodies[1]);
    assert.ok(!sent.includes("0123456789"), "account number must not be sent");
    assert.ok(!sent.includes("FT23109ABCD12"), "reference must not be sent");
    assert.ok(sent.includes("TRF TO ZUBAIRU [ref] REF [ref]"));
    assert.equal(reply.evidence.transactions.length, 1);
    // Only the user's message and tool output are sent — not the whole transaction list
    assert.ok(!sent.includes("SHOPRITE"), "unrelated transactions are not sent");
  } finally {
    m.close();
  }
});

test("tool errors are returned to the model, not hidden", async () => {
  const m = await mock((body, n) => (n === 1 ? { json: call("get_subscription", { ref: "nonexistent-bill" }) } : { json: text(JSON.stringify(body.contents.at(-1).parts[0].functionResponse.response)) }));
  try {
    const reply = await runGemini([{ role: "user", content: "Tell me about my yacht club" }], { state: state(), rates: {}, today }, m.ai);
    assert.match(reply.text, /not found|error|No /i);
  } finally {
    m.close();
  }
});

test("rate limits and missing key map to clear errors", async () => {
  const m = await mock(() => ({ status: 429, json: { error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } } }));
  try {
    await assert.rejects(runGemini([{ role: "user", content: "hi" }], { state: state(), rates: {}, today }, m.ai), (e) => describeError(e).code === "rate_limited");
  } finally {
    m.close();
  }
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(runGemini([{ role: "user", content: "hi" }], { state: state(), rates: {}, today }), (e) => describeError(e).code === "unavailable");
  if (prev) process.env.GEMINI_API_KEY = prev;
});
