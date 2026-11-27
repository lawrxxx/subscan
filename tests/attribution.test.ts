import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, erc20Abi } from "viem";
import { fromDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_CODES, decodeAttribution, tagCalldata } from "../src/lib/celo/attribution.ts";

test("tags ERC-20 transfer calldata without changing the call", () => {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 5_000_000n] });
  const tagged = tagCalldata(data);
  assert.ok(tagged.length > data.length);
  assert.deepEqual(decodeAttribution(tagged), ATTRIBUTION_CODES);
  // ABI decoding ignores the trailing suffix — the transfer is unchanged.
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tagged });
  assert.equal(decoded.functionName, "transfer");
  assert.equal(decoded.args[1], 5_000_000n);
});

test("does not double-tag calldata that already carries a suffix", () => {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x000000000000000000000000000000000000dEaD", 1n] });
  const once = tagCalldata(data);
  assert.equal(tagCalldata(once), once);
  assert.equal(fromDataSuffix(data), null);
});
