# subscan

A personal money autopilot on Celo mainnet. People set **money rules** for their stablecoin balances (keep a minimum, convert when low, keep a share in dollars, cap automated transfers) and schedule **recurring transfers** to saved, confirmed recipients. Everything runs from the user's own Altana smart wallet under limits they grant; conversions go through Textile FX (USD₮ ↔ cNGN) at firm quotes. Decisions are deterministic rules. No language model is involved.

Responsibilities: **subscan** (rules, schedules, planning, checks, records) · **Altana** (wallet, session permissions, execution, revocation) · **Textile FX** (conversion).

## Architecture

No database:

1. **Vercel**: hosts the Next.js app. `src/app/api/autopilot` holds the sealed session key and runs every check before signing; `src/app/api/fx/*` proxies Textile FX.
2. **Altana**: the user's passkey smart wallet. The session it grants subscan is limited on-chain to five calls (USD₮/cNGN approve and transfer, the Textile reactor), a monthly cap per token and an expiry, and can be revoked in one transaction.
3. **Textile FX**: live rates (to size rules) and firm quotes (to execute).
4. **Celo mainnet**: every transaction verified by receipt, tagged ERC-8021; ERC-8004 agent identity.

Rules, schedules, recipients and activity live in the browser (`src/lib/db`). **Automation runs only while subscan is open in a browser**: there is no background server or store, so nothing executes while it's closed. Transfers up to 3 days late are sent on the next open; older ones wait for the user's OK.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Deploy (Vercel)

Import the repo in Vercel (framework: Next.js, defaults). Manage environment variables with `npm run env:sync` (see below); `AUTOPILOT_SEAL_KEY` is required for Autopilot; `TEXTILE_API_KEY` is recommended. Redeploy after changing `NEXT_PUBLIC_*` values.

## Environment variables (Vercel CLI)

`env.manifest.json` lists every variable the app reads (names and rules only, never values). `scripts/vercel-env.mjs` manages them on the linked Vercel project through the Vercel CLI:

```
npx vercel login           # once
npx vercel link            # once; writes .vercel/ (git-ignored)
npm run env:status         # configured vs missing per environment; never prints values
npm run env:sync           # prompts (hidden input) for everything missing, then redeploys and verifies
npm run env:add -- AUTOPILOT_SEAL_KEY            # add one variable
npm run env:add -- AUTOPILOT_SEAL_KEY --replace  # overwrite; asks you to type the name to confirm
npm run env:deploy         # redeploy production
npm run env:verify         # check the live deployment picked the values up
```

Secrets are stored as Vercel sensitive variables in production and preview, and are read from a hidden prompt or stdin, never from arguments. Existing values are never overwritten without `--replace` and a typed confirmation. `NEXT_PUBLIC_*` variables are visible in the browser and can't be secrets. To add a new variable, add it to the manifest and run `npm run env:sync`.

## Layout

| Path | What |
| --- | --- |
| `src/lib/money/` | `rules.ts` (what a rule needs now), `schedule.ts` (dates), `plan.ts` (what's due), `runner.ts` (runs it, one tab at a time), `verify.ts` (receipt check), `actions.ts` (approve / retry / cancel), `policy.ts` (sync recipients + caps to the server) |
| `src/lib/autopilot/` | Altana: session template, sealed key, server execution (transfer / convert), browser wallet + grant |
| `src/lib/payments/engine.ts` | Every check a movement must pass (recipient, per-transfer cap, monthly cap, balance, expiry, route, duplicate) |
| `src/lib/textile/` | Textile FX v2 RFQ client |
| `src/lib/celo/` | Celo config (verified addresses), everyday wallet (EIP-1193), ERC-8021 tags |
| `src/lib/db/` | Store, migration from older versions, storage adapter |
| `scripts/autopilot-mainnet-test.ts` | Live mainnet test of the whole path |
