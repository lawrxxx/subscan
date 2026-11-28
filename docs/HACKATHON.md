# subscan · Celo Agents Open for Business

subscan is a **rule-based personal money autopilot** (no language model). People set money rules for
their stablecoin balances and schedule recurring transfers to saved recipients. Everything runs from
the user's own **Altana** smart agentic wallet under a session they grant; **Textile FX** converts
USD₮ ↔ cNGN at firm quotes.

| Layer | Responsibility | Code |
| --- | --- | --- |
| subscan | rules, schedules, planning, every pre-signing check, records and verification | `lib/money/*`, `lib/payments/engine.ts` |
| Altana | smart wallet, session permissions, execution, revocation | `lib/autopilot/*` (`@altananetwork/sdk`) |
| Textile FX | stablecoin conversion (RFQ v2) | `lib/textile/*` |

Tracks entered: **Stablecoin Corridors (Textile FX)** and **Altana Smart Agentic Wallets**.

## 1. How it works

```
Money rules (keep a minimum · convert when low · keep a share · cap transfers)
Recurring transfers (saved, confirmed recipients · once / weekly / monthly · limits)
        │  stored in the browser
        ▼
Planner (lib/money/plan.ts, pure): what's due now, from real balances and today's date
        │  runs every minute while subscan is open, one tab at a time (Web Locks)
        ▼
Activity record saved as "processing" with an idempotency key   ── then ──▶  /api/autopilot  execute
                                                                              1. open sealed policy (AES-256-GCM)
                                                                              2. read on-chain: key authorised, remaining monthly cap, balances
                                                                              3. checks: saved recipient, per-transfer cap, rule max vs firm quote, duplicate
                                                                              4. conversion → Textile firm quote (taker = the user's Altana wallet)
                                                                              5. one Altana session execute ([transfer] or [approve, swap])
                                                                              6. wait for receipt
        ▼
Browser re-reads the receipt and checks the expected token Transfer log → "completed"
```

States: scheduled · awaiting approval · processing · completed · failed · cancelled.
Transfers more than 3 days late (subscan wasn't open) wait for approval; a rule converts at most once
per 6-hour window and never stacks. A processing record with no hash after 15 minutes is marked
failed with a warning to check the wallet before retrying.

## 2. Where each limit is enforced

| Limit | Enforced by |
| --- | --- |
| Which contracts and functions (USD₮/cNGN approve + transfer, Textile reactor) | **Altana wallet contract, on-chain** |
| Monthly cap per token (includes relay fees) | **Altana wallet contract, on-chain** |
| Expiry and one-transaction revoke | **Altana wallet contract, on-chain** |
| Recipient must be saved and confirmed | subscan server, before signing (Altana call permissions have no argument rules) |
| Per-transfer cap (payment wallet cap and "never above" rules, the stricter) | subscan server, before signing; the planner also blocks it |
| Rule's maximum conversion vs the live firm quote | subscan server, before signing |
| Max total, end date and per-transfer limit of a schedule | planner, before anything is sent |

## 3. Limitations (stated in the product)

1. **No background execution.** No database or server-side store, so rules and transfers run only while subscan is open in a browser.
2. **Recipient allowlist and per-transfer cap are off-chain** (server checks), by design of Altana's permission model.
3. **Textile route:** USD₮ ↔ cNGN on Celo, minimum about 1 USD₮ (≈1,450 cNGN). Anything else is refused with Textile's reason.
4. **Keyless conversions from Face ID wallets:** the server signs Textile's taker proof with the session key (`signOrderTypedData`, ERC-1271). Whether Textile accepts it for passkey wallets is being verified on mainnet (§5, round 2). With `TEXTILE_API_KEY` (partner key) no proof is needed.
5. **Setup cost:** ≈9.3 CELO once per new wallet (Altana KeyStore registration of the wallet); later grants cost only the relay fee (session keys are granted with `register: false`).

## 4. Environment variables (Vercel)

| Name | Need | Notes |
| --- | --- | --- |
| `AUTOPILOT_SEAL_KEY` | required | 32+ character random password (or 64 hex). Server only. Set |
| `TEXTILE_API_KEY` | optional | Mainnet partner key (`tx_live_`). Not set: only a testnet key exists |
| `ERC8004_AGENT_ID` | recommended | subscan's own agent id |

## 5. Verified transaction evidence

### Round 1: Altana permissions + Textile inside a session (28 Nov 2026, bill-payment build, same Altana/Textile path)

Altana + Textile, Celo mainnet, 28 Nov 2026. Wallet `0xCf1242929b1ABFC9264c7B6f7Ff87a8403C2B187`,
approved recipient `0x044d4b5C1a7B247d9C03e192e88c91d260f669c8`.

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Grant session (calls allowlist, monthly caps, 1 h expiry); subscan's server verifies it on-chain | Pass | [`0x7a63aea0…`](https://celoscan.io/tx/0x7a63aea06bcdaeda86895d184d9c009bfa3c7ebf064e263268df5600df5cecd3) |
| 2 | Eligible payment through subscan's server, 0.10 USD₮ | Confirmed, tag `altana,subscan,celo_e97672462153` | [`0x712e5aea…`](https://celoscan.io/tx/0x712e5aea80baee0d9bacbec58aed28e3e75964d0ad65f761ab80f806f3a77009) |
| 3 | Unapproved recipient | Refused by subscan before signing (`recipient_not_approved`) | no transaction |
| 4 | Over the cap (1.5 USD₮ > 1 USD₮ cap) | Rejected by the account: `spend_limit_exceeded` | no transaction |
| 5 | Call outside the allowlist (`cNGN.approve`) | Rejected by the account: `call_not_permitted` | no transaction |
| 6 | Textile FX inside the session: 1.007711 USD₮ → 1,450 cNGN (fee 0.000201 USD₮) and pay recipient, one transaction | Confirmed, tagged. RFQ `rfq_hwCZY0Vs98BbP71o` | grant [`0xdaa5c8d1…`](https://celoscan.io/tx/0xdaa5c8d1d127334e6aee94046db05c5d2b729c7052b3ecc87114271443f70667) · pay [`0x3ef86b66…`](https://celoscan.io/tx/0x3ef86b6685b4c667cbc74f10b9619ae5f53e16c47cdd9ca5f32e98ab7dbe646a) · revoke [`0xf7afdb2f…`](https://celoscan.io/tx/0xf7afdb2f56dc15f2fbe245adc00f7a165efa0ba6d272dbb2955ad82d39af2469) |
| 7 | 2-minute session, payment after expiry | Rejected: `session_expired` | grant [`0xf1051569…`](https://celoscan.io/tx/0xf105156956f9126b9f08b0fce10cfa2b37148d5aabab17110f3ede8b15cc9d42) |
| 8 | Revoke (one transaction), then pay | Rejected by the account; subscan's server reports `key_not_authorized` | [`0xc707279a…`](https://celoscan.io/tx/0xc707279a6cbf45782f2f4677ea8e5bcd2e311d8e3d8f8e4b49e0fae3acfb3624) |

Test 6 ran separately with a 2 USD₮ / 1,600 cNGN cap because Textile's minimum order is above the
first run's 1 USD₮ cap; the script now uses that cap for every test.

Earlier: Textile FX keyless conversion from the owner's wallet (2,000 cNGN for 1.3891 USD₮), recorded in
the app's payment history.


### Round 2: money autopilot build

Pending a funded test wallet: `scripts/autopilot-mainnet-test.ts` runs grant → transfer to saved recipient →
unsaved recipient refused → per-transfer cap refused → rule conversion USD₮→cNGN (keyless session proof) →
rule max refused → cNGN→USD₮ conversion → on-chain monthly cap and call-list rejections → revoke.

## 6. Demo script (≈4 min)

1. Home: honest empty state → *Get started* → create the payment wallet (Face ID) → add money from MiniPay.
2. Give access: monthly limits, per-transfer cap, 30 days; shown on Celoscan.
3. Money rules → *Keep a minimum balance*: keep 5,000 cNGN, top up from USD₮. On the next check subscan converts on Textile (firm quote, fee shown) and the activity shows the verified hash.
4. Transfers → *Schedule a transfer*: add Mum, confirm the address, 2,000 cNGN every month, summary, activate. The first one goes out; activity shows the hash.
5. Add a "never above 1,000 cNGN" rule → the next transfer is blocked before signing, with the reason.
6. Payment wallet → *Revoke* (one transaction) → the next attempt is refused.
