import { test } from "node:test";
import assert from "node:assert/strict";

test("older data: bills and statements dropped, confirmed payments kept as completed transfers", async () => {
  // store.tsx is a client module; import the pure migrate() through a tiny shim.
  const { migrate } = await import("../src/lib/db/migrate.ts");
  const old = {
    transactions: [{ id: "t1" }],
    subscriptions: [{ id: "s1" }],
    payments: [
      { id: "p1", createdAt: "2026-11-20T00:00:00Z", merchant: "Landlord", destinationToken: "cNGN", destinationAmount: "2000", status: "confirmed", steps: [{ kind: "settlement", hash: "0xabc" }] },
      { id: "p2", createdAt: "2026-11-21T00:00:00Z", merchant: "Draft", destinationToken: "cNGN", destinationAmount: "1", status: "prepared", steps: [] },
    ],
    settings: { homeCurrency: "NGN", payGasInUsdt: true, wallet: "0x1111111111111111111111111111111111111111" },
    autopilot: { wallet: "0x2222222222222222222222222222222222222222", enabled: true, sealedPolicy: "x", limits: { USDT: "1", cNGN: "1" }, recipients: [{ address: "0x3", label: "x" }] },
  };
  const s = migrate(old);
  assert.equal(s.version, 2);
  assert.equal(s.activity.length, 1);
  assert.equal(s.activity[0].txHash, "0xabc");
  assert.equal(s.activity[0].status, "completed");
  assert.equal(s.autopilot?.enabled, false, "automation starts paused after the upgrade");
  assert.equal(s.autopilot?.templateVersion, 1);
  assert.ok(s.legacyCleared);
  assert.equal((s as unknown as Record<string, unknown>).subscriptions, undefined);
  assert.equal(s.settings.payGasInUsdt, true);
  assert.deepEqual(migrate(null).rules, []);
});
