// Registers the subscan agent on the ERC-8004 Identity Registry (Celo mainnet).
// Usage:
//   AGENT_OWNER_PRIVATE_KEY=0x... AGENT_URI=https://your-app/api/erc8004 npm run agent:register
// The key's address becomes the identity owner and agentWallet. Use a dedicated,
// lightly funded wallet. Pass PAY_GAS_IN_USDT=1 to pay gas in USD₮ (fee abstraction).
// Flow follows https://docs.celo.org/build/agents/8004 (simulate → write → read Registered event).
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ERC8004, ERC8004_IDENTITY_ABI, RPC_URL, TOKENS, txUrl } from "../src/lib/celo/config.ts";
import { ATTRIBUTION_SUFFIX } from "../src/lib/celo/attribution.ts";

const key = process.env.AGENT_OWNER_PRIVATE_KEY as `0x${string}` | undefined;
const uri = process.env.AGENT_URI;
if (!key || !uri) {
  console.error("Set AGENT_OWNER_PRIVATE_KEY and AGENT_URI (e.g. https://your-deployment/api/erc8004).");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

console.log(`Registering ${uri} from ${account.address} on Celo mainnet…`);
const { request } = await publicClient.simulateContract({
  account,
  address: ERC8004.identityRegistry,
  abi: ERC8004_IDENTITY_ABI,
  functionName: "register",
  args: [uri],
});
const hash = await walletClient.writeContract({
  ...request,
  dataSuffix: ATTRIBUTION_SUFFIX, // ERC-8021 attribution
  ...(process.env.PAY_GAS_IN_USDT ? { feeCurrency: TOKENS.USDT.feeCurrencyAdapter } : {}),
});
console.log(`tx: ${txUrl(hash)}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const [registered] = parseEventLogs({ abi: ERC8004_IDENTITY_ABI, eventName: "Registered", logs: receipt.logs });
if (!registered) {
  console.error("No Registered event in receipt", receipt.status);
  process.exit(1);
}
console.log(`Registered agentId ${registered.args.agentId} → set ERC8004_AGENT_ID=${registered.args.agentId}`);
