# subscan

Subscription intelligence and payment agent on Celo mainnet. Import a statement → detect recurring payments → understand spend → let the agent prepare a payment → approve it in your wallet → settle on chain (Textile FX conversion USD₮ ↔ cNGN, then merchant settlement by direct transfer or x402).

## Run

```bash
npm install
cp .env.example .env.local   # all optional; see below
npm run dev                  # http://localhost:3000
```

Checks: `npm run typecheck`, `npm test` (detection engine), `npm run build`.

Behind an HTTP proxy, start Node with `NODE_USE_ENV_PROXY=1` so server-side fetches (Textile FX, Celo RPC) use it.

## Layout

| Path | What |
| --- | --- |
| `src/lib/detection/` | CSV parsing, recurring-payment detection, spend/renewal/duplicate/waste analysis |
| `src/lib/agent/` | Agent tools (real app data + live chain/FX) and the Claude tool-use loop |
| `src/lib/celo/` | Central Celo config (verified addresses), browser wallet (viem, EIP-1193) |
| `src/lib/textile/` | Textile FX v2 RFQ client, TakerControl proof signing |
| `src/lib/merchant/` | x402 probe/pay (official `@x402/*` packages) |
| `src/lib/payments/` | Payment planning and step-by-step execution |
| `src/lib/db/` | Local store (browser) and optional Supabase receipt mirror (`supabase/schema.sql`) |
| `src/lib/bank/` | Bank data providers: CSV (working), Mono (slot, not implemented) |
| `scripts/register-agent.ts` | ERC-8004 Identity Registry registration |

## Verified integration constants (Celo, chain 42220)

All checked against official docs and on chain on 2026-11-26 — see `src/lib/celo/config.ts`.

- USD₮ `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (6 dp) · cNGN `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` (6 dp)
- Textile FX LimitOrderReactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`, API `https://api.textilecredit.com/v2`
- ERC-8004 Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- USD₮ fee-currency adapter `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72`

Mocked/sample data is always labelled. The app never displays a transaction as confirmed without an on-chain receipt.
