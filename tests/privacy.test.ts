import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactText } from "../src/lib/agent/privacy.ts";

test("redacts account, card, phone, email and references from free text", () => {
  assert.equal(redactText("TRF TO ADEBAYO 0123456789 GTB"), "TRF TO ADEBAYO [ref] GTB");
  assert.equal(redactText("POS 5399 8312 4410 1234 SHOPRITE"), "POS [card] SHOPRITE");
  assert.equal(redactText("CARD 539983******1234 NETFLIX"), "CARD [card] NETFLIX");
  assert.equal(redactText("AIRTIME 08031234567"), "AIRTIME [phone]");
  assert.equal(redactText("from jane.doe@mail.com"), "from [email]");
  assert.equal(redactText("REF FT23109ABCD12 DSTV"), "REF [ref] DSTV");
  assert.equal(redactText("NETFLIX.COM 4400"), "NETFLIX.COM 4400");
});

test("keeps identifiers, dates and numbers needed by the app", () => {
  const out = redact({
    id: "netflix-NGN-0",
    hash: "0x1234567890abcdef1234567890abcdef12345678",
    review_url: "/pay/netflix-NGN-0",
    transactions: [{ date: "2026-08-03", description: "TRF 0123456789", amount: 1234567, currency: "NGN" }],
  });
  assert.equal(out.id, "netflix-NGN-0");
  assert.equal(out.hash, "0x1234567890abcdef1234567890abcdef12345678");
  assert.equal(out.transactions[0].date, "2026-08-03");
  assert.equal(out.transactions[0].amount, 1234567);
  assert.equal(out.transactions[0].description, "TRF [ref]");
});
