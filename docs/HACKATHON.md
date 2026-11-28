# subscan · Celo Agents Open for Business

subscan is a personal bills agent. People upload a bank statement; subscan finds their
regular payments, shows what's coming up and where they could save, and (with Autopilot)
pays chosen bills for them from a wallet they control, within limits they set.

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
| Agent tool `autopilot_check` | `src/lib/agent/tools.ts` |

## 2. Textile FX status

| Item | Status |
| --- | --- |
| RFQ v2 preview / firm request / submit / status / cancel | Implemented (`/api/fx/*`) |
| Corridor | USD₮ ↔ cNGN on Celo mainnet (reactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`) |
| Manual flow, keyless (EIP-712 TakerControl from the user's wallet) | **Proven on mainnet** earlier in the build: 2,000 cNGN paid for 1.3891 USD₮ (rate 1,439.80, fee 0.0003 USD₮), tagged |
| Autopilot flow (taker = Altana smart wallet) | Implemented: firm quote + atomic approve/swap/transfer batch. Needs `TEXTILE_API_KEY` for passkey wallets (Textile verifies a smart-account proof via EIP-1271; a partner key skips the proof). **Not yet run on mainnet** (see blockers) |
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
| Grant cost (measured) | ~18.6 CELO one-time KeyStore registration + relay fee; shown to the user before they confirm (`quoteGrantSession`) |
| Live mainnet permission tests | Script ready (`scripts/autopilot-mainnet-test.ts` flow, see §7); **waiting on a funded test wallet** |

## 4. Environment variables (Vercel)

| Name | Need | Notes |
| --- | --- | --- |
| `AUTOPILOT_SEAL_KEY` | required for Autopilot | `openssl rand -hex 32`. Server only |
| `GEMINI_API_KEY` | required for Ask subscan | Server only |
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

Test wallet: `0xCf1242929b1ABFC9264c7B6f7Ff87a8403C2B187` (needs ≈ 20 CELO + 3–5 USD₮).

1. Grant subscan's session (template above, 1 USD₮ / 800 cNGN monthly, 1 h expiry)
2. Eligible payment through subscan's server (0.10 USD₮ to an approved recipient) → confirmed + tag
3. Unapproved recipient → refused by subscan before signing
4. Over the cap (1.5 USD₮) → rejected by the account
5. Call outside the allowlist (`cNGN.approve`) → rejected by the account
6. Textile conversion inside the session: firm quote → approve + swap + pay 100 cNGN, one transaction
7. Short session (2 min) → payment after expiry rejected
8. Revoke → payment rejected; subscan's server reports `key_not_authorized`

Evidence (hashes) is written to the session's evidence file and will be added here.

## 8. Verified transaction evidence

* Textile FX manual payment (earlier mainnet test by the project owner): recorded in the app's
  payment history; hash to be copied here from the receipt page.
* Altana: pending funding (§7).

## 9. Outstanding blockers

1. **Test wallet unfunded**: live Altana + combined tests cannot run until it holds ≈ 20 CELO + a few USD₮.
2. **`AUTOPILOT_SEAL_KEY` not set on Vercel**: the live site shows "Autopilot isn't switched on" until it is.
3. **`TEXTILE_API_KEY` not set**: Autopilot conversions from passkey wallets need it.
4. **`GEMINI_API_KEY` not set**: Ask subscan is unavailable on the live site.
5. **ERC-8004 id for subscan itself** not registered/recorded yet (Autopilot wallets self-register via the SDK).
6. Altana recipient allowlist is off-chain by design of the permission model (documented).
7. Autopilot runs when the user opens subscan (browser storage only, no server database); there is no background scheduler.

## 10. Demo script

**Textile FX (≈ 2 min)**
1. Home → *Add a statement* → upload a statement → results → *Import*.
2. Payments → open a naira bill → *Pay from a digital wallet* → add the provider's Celo address.
3. *Review a payment*: "You send" USD₮, live Textile rate and fee, "Recipient gets" cNGN, network Celo 42220.
4. Approve in MiniPay: approve → Textile swap → transfer; receipt shows three hashes with the ERC-8021 tag.

**Altana (≈ 3 min)**
1. Settings → *Autopilot*: read "what it can and can't do".
2. *Create Autopilot wallet* (Face ID). *Add money* from MiniPay (USD₮ + CELO for setup).
3. Set limits (e.g. 20 USD₮ / 30,000 cNGN a month), approve the bill's recipient, 30 days; see the setup cost; *Give subscan access* (Face ID). Show the grant on Celoscan.
4. Mark the bill *Auto*; open Home: Autopilot pays it (converting USD₮→cNGN on Textile in the same transaction) and shows the hash.
5. Try a bill to an unapproved recipient → refused, with the reason. Lower the limit → over-limit refused by the wallet.
6. *Revoke subscan's access* (one transaction) → the next attempt is refused.
