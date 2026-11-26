-- subscan: payment receipts mirrored from the client (optional).
create table if not exists public.payment_records (
  id text primary key,
  created_at timestamptz not null,
  wallet text,
  subscription_id text not null,
  merchant text not null,
  source_token text not null,
  destination_token text not null,
  source_amount text not null,
  destination_amount text not null,
  fee_amount text,
  rate text,
  recipient text,
  method text not null check (method in ('address', 'x402')),
  rfq_id text,
  status text not null check (status in ('prepared', 'pending', 'confirmed', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists payment_records_wallet_idx on public.payment_records (wallet);
-- Only the service role (server) writes; no anon access.
alter table public.payment_records enable row level security;
