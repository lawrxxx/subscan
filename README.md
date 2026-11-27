# subscan

Subscription intelligence and payment agent on Celo mainnet. Import a statement → detect recurring payments → understand spend → let the agent prepare a payment → approve it in your wallet → settle on chain (Textile FX conversion USD₮ ↔ cNGN, then merchant settlement by direct transfer or x402).

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without Supabase variables the app runs in **guest mode** (data stays in the browser). With them, sign-in is required and all data is stored per user in Supabase with row-level security.

Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Production setup (Supabase + Vercel)

1. **Supabase** → create a project → SQL editor → run `supabase/migrations/20261127000000_subscan_init.sql`.
2. Supabase → Authentication → URL configuration: Site URL = your Vercel URL; add `https://<your-domain>/auth/callback` to Redirect URLs.
3. **Vercel** → Project → Settings → Environment Variables (Production): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `ANTHROPIC_API_KEY`, `MONO_SECRET_KEY`, `MONO_WEBHOOK_SECRET`. Redeploy.
4. **Mono** (optional) → dashboard → webhook URL `https://<your-domain>/api/mono/webhook`, secret = `MONO_WEBHOOK_SECRET`.

## Layout

| Path | What |
| --- | --- |
| `src/lib/detection/` | CSV parsing, recurring-payment detection, spend/renewal/duplicate/waste analysis |
| `src/lib/agent/` | Agent tools (real app data + live chain/FX) and the Claude tool-use loop |
| `src/lib/celo/` | Central Celo config (verified addresses), browser wallet (viem, EIP-1193) |
| `src/lib/textile/` | Textile FX v2 RFQ client, TakerControl proof signing |
| `src/lib/merchant/` | x402 probe/pay (official `@x402/*` packages) |
| `src/lib/payments/` | Payment planning and step-by-step execution |
| `src/lib/db/` | Client store (account/guest), zod schemas, Supabase repository |
| `src/lib/supabase/` | Browser/server/admin clients; `src/middleware.ts` protects routes |
| `src/lib/mono/` | Mono Connect: initiate, webhook, transaction sync |
| `supabase/migrations/` | Schema + row-level security |
| `scripts/register-agent.ts` | ERC-8004 Identity Registry registration |

## Verified integration constants (Celo, chain 42220)

All checked against official docs and on chain on 2026-11-26 — see `src/lib/celo/config.ts`.

- USD₮ `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (6 dp) · cNGN `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` (6 dp)
- Textile FX LimitOrderReactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`, API `https://api.textilecredit.com/v2`
- ERC-8004 Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- USD₮ fee-currency adapter `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72`

Mocked/sample data is always labelled. The app never displays a transaction as confirmed without an on-chain receipt.
