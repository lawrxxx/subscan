# subscan · Celo Agents Open for Business

subscan is a **rule-based** personal bills agent (no language model). People upload a bank
statement; subscan's deterministic rules find their regular payments, schedule what's due and
decide what to pay. Payments run from the user's own **Altana** smart agentic wallet under a
session they grant; **Textile FX** converts USD₮ ↔ cNGN when a bill needs it.

| Layer | Responsibility | Code |
| --- | --- | --- |
| subscan | statement parsing, recurring detection, scheduling, payment rules, decisions | `lib/import`, `lib/detection`, `lib/agent/rules.ts`, `lib/payments/engine.ts` |
| Altana | smart agentic wallet, session keys, on-chain permissions, execution, revocation | `lib/autopilot/*` (`@altananetwork/sdk`) |
| Textile FX | stablecoin conversion (RFQ v2) | `lib/textile/*` |

Tracks entered: **Stablecoin Corridors (Textile FX)** and **Altana Smart Agentic Wallets**.

## 1. Architecture

```
Statement (PDF/CSV, parsed in the browser)
        │
        ▼
Detection → bills with verified recipient (Celo address the user added)
        │
        ├── Manual pay (/pay/[id]) ─ user's own wallet (MiniPay/MetaMask), one prompt per step
        │        approve → Textile swap → transfer   (each tx tagged ERC-8021)
        │
        └── Autopilot (/autopilot) ─ user's Altana smart wallet (passkey admin)
                 │  session granted to subscan's agent key: calls allowlist, monthly cap, expiry
                 ▼
          /api/autopilot  (server)
            1. open sealed policy (AES-256-GCM, AUTOPILOT_SEAL_KEY)
            2. read on-chain: key authorised? remaining monthly allowance (spendInfos), balances
            3. shared engine checks (lib/payments/engine.ts)
            4. bill needs another token → Textile FX firm quote, taker = Altana wallet
            5. one atomic Altana execute: [USD₮.approve(reactor), reactor swap, cNGN.transfer(recipient)]
            6. wait for receipt → "confirmed" only on success; report hash to Textile /submit
```

Shared payment engine (`src/lib/payments/engine.ts`): stages `detected → prepared → quoted →
converted → submitted → confirmed | failed`, and `checkAutopay()` which returns every refusal:
`autopilot_off, access_expired, access_revoked, key_not_authorized, recipient_not_approved,
over_limit, insufficient_funds, route_unavailable, invalid_amount, already_paid`.

Key files

| Area | File |
| --- | --- |
| Session template (shared by grant and execute) | `src/lib/autopilot/permissions.ts` |
| Browser: passkey wallet, fund, grant, quote, revoke | `src/lib/autopilot/browser.ts` |
| Server: issue/seal key, activate, status, pay | `src/lib/autopilot/server.ts`, `src/app/api/autopilot/route.ts` |
| Autonomous runner (due bills marked Auto) | `src/lib/autopilot/runner.ts` |
| Textile RFQ v2 client | `src/lib/textile/client.ts` |
| Manual pay flow | `src/app/pay/[id]/page.tsx`, `src/lib/payments/execute.ts` |
| Agent rules (decision per bill) | `src/lib/agent/rules.ts` |
| Agent page (decisions, needs-you, quick answers) | `src/app/agent/page.tsx` |

## 2. Textile FX status

| Item | Status |
| --- | --- |
| RFQ v2 preview / firm request / submit / status / cancel | Implemented (`/api/fx/*`) |
| Corridor | USD₮ ↔ cNGN on Celo mainnet (reactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`) |
| Manual flow, keyless (EIP-712 TakerControl from the user's wallet) | **Proven on mainnet** earlier in the build: 2,000 cNGN paid for 1.3891 USD₮ (rate 1,439.80, fee 0.0003 USD₮), tagged |
| Autopilot flow (taker = Altana smart wallet) | **Proven on mainnet** (§8, test 6): firm quote + atomic approve/swap/transfer in one session transaction. Keyless proof worked for a wallet with an EOA admin; passkey wallets still need `TEXTILE_API_KEY`. Textile's minimum order is ≈1,440 cNGN (≈1 USD₮) |
| Builder codes in Textile's own tag | With `TEXTILE_API_KEY`: `includeAttribution` + `builderCodes` |

## 3. Altana status

| Item | Status |
| --- | --- |
| SDK | `@altananetwork/sdk@1.2.0`, network `CELO` (42220), relay `relay.altana.network` |
| Passkey wallet creation in the browser | **Verified** (virtual authenticator, Celo mainnet relay): wallets created in ~5 s, only address + public credential stored |
| Session template | calls: `USD₮.approve`, `USD₮.transfer`, `cNGN.transfer`, Textile reactor (any method); spend: monthly cap on USD₮ and cNGN; expiry 7/30/90 days |
| On-chain enforcement | Account contract (calls allowlist, spend caps incl. relay fee, expiry); revocation one transaction |
| Recipient allowlist | **Not enforceable on-chain** (call permissions have no argument rules). Enforced by subscan's server before signing; stated in the UI |
| Agent key custody | Per-user key generated server-side, sealed; never in the browser, never stored server-side |
| ERC-8021 | `altana,subscan,celo_e97672462153` on every Autopilot transaction (`appCode`) |
| ERC-8004 | Autopilot wallet registered by the SDK after its first admin action as "subscan Autopilot" (registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) |
| Grant cost | A new wallet's first admin action registers the wallet in Altana's KeyStore: ≈9.3 CELO once (measured), shown before the user confirms. Each session key is granted with `register: false`, so later grants cost only the relay fee; the session is still authorised and enforced by the wallet contract (only the optional public listing of the session key, another ≈9.3 CELO each time, is skipped) |
| Live mainnet permission tests | **All 8 passed on Celo mainnet, 28 Nov 2026** (§8) |

## 4. Environment variables (Vercel)

| Name | Need | Notes |
| --- | --- | --- |
| `AUTOPILOT_SEAL_KEY` | required for Autopilot | 32+ character random password (or 64 hex). Server only. Set |
| `TEXTILE_API_KEY` | recommended | Needed for Autopilot conversions from passkey wallets |
| `ERC8004_AGENT_ID` | recommended | subscan's own agent id |
| `NEXT_PUBLIC_APP_URL` | recommended | ERC-8004 agent card |

All listed in `env.manifest.json`; `npm run env:sync` adds them through the Vercel CLI with hidden prompts.

## 5. Deploy

Push to `claude/admiring-cerf-0e3i28` (Vercel builds it). Then:

```bash
npx vercel login && npx vercel link
npm run env:add -- AUTOPILOT_SEAL_KEY      # paste: output of openssl rand -hex 32
npm run env:add -- TEXTILE_API_KEY
npm run env:deploy && npm run env:verify
```

## 6. Tests

* Unit (`npm test`): 42 passing, including engine refusals (over limit, unapproved recipient,
  expired, revoked, unauthorised key, no route, no funds, already paid), the exact session
  template, sealing (wrong secret / wrong wallet rejected), statement direction parsing.
* Browser (Playwright): full app 183/183, import flow 89/89, Autopilot UI: passkey wallet
  creation on Celo, no secrets stored, plain language, unfunded grant fails with Altana's own
  message (no fake success).

## 7. Mainnet test plan (runs once the test wallet is funded)

Test wallet: `0xCf1242929b1ABFC9264c7B6f7Ff87a8403C2B187`. Limits 2 USD₮ / 1,600 cNGN a month.

1. Grant subscan's session (template above, 1 USD₮ / 800 cNGN monthly, 1 h expiry)
2. Eligible payment through subscan's server (0.10 USD₮ to an approved recipient) → confirmed + tag
3. Unapproved recipient → refused by subscan before signing
4. Over the cap (2.5 USD₮) → rejected by the account
5. Call outside the allowlist (`cNGN.approve`) → rejected by the account
6. Textile conversion inside the session: firm quote → approve + swap + pay 1,450 cNGN, one transaction
7. Short session (2 min) → payment after expiry rejected
8. Revoke → payment rejected; subscan's server reports `key_not_authorized`

Evidence is in §8.

## 8. Verified transaction evidence

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

Earlier: Textile FX manual payment from the owner's wallet (2,000 cNGN for 1.3891 USD₮), recorded in
the app's payment history.

## 9. Outstanding blockers

1. **`AUTOPILOT_SEAL_KEY`**: added on Vercel by the owner (28 Nov); confirm `/api/autopilot` reports `available: true` after each deploy.
2. **`TEXTILE_API_KEY`**: only a testnet key is available to the owner, which Textile rejects on Celo mainnet, so it is deliberately not set. Manual conversions work keyless; Autopilot pays in the currency the wallet holds and refuses conversions honestly.
3. **ERC-8004 id for subscan itself** not registered/recorded yet (Autopilot wallets self-register via the SDK).
4. Altana recipient allowlist is off-chain by design of the permission model (documented).
5. Autopilot runs when the user opens subscan (browser storage only, no server database); there is no background scheduler.

## 10. Demo script

**Textile FX (≈ 2 min)**
1. Home → *Add a statement* → upload a statement → results → *Import*.
2. Payments → open a naira bill → *Pay from a digital wallet* → add the provider's Celo address.
3. *Review a payment*: "You send" USD₮, live Textile rate and fee, "Recipient gets" cNGN, network Celo 42220.
4. Approve in MiniPay: approve → Textile swap → transfer; receipt shows three hashes with the ERC-8021 tag.

**Altana (≈ 3 min)**
1. Settings → *Autopilot*: read "what it can and can't do".
2. *Create Autopilot wallet* (Face ID). *Add money* from MiniPay (≈10 CELO for the one-time wallet registration, plus a few USD₮).
3. Set limits (e.g. 20 USD₮ / 30,000 cNGN a month), approve the bill's recipient, 30 days; *Give subscan access* (Face ID). Show the grant on Celoscan.
4. Mark the bill *Auto*; open **Agent**: the bill shows *Paying now* with the rule that allowed it; tap *Pay due now* (or open Home): Autopilot pays it (converting USD₮→cNGN on Textile in the same transaction) and shows the hash.
5. Try a bill to an unapproved recipient → refused, with the reason. Lower the limit → over-limit refused by the wallet.
6. *Revoke subscan's access* (one transaction) → the next attempt is refused.
