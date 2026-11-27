-- subscan schema. Every table is owned by a Supabase auth user and protected by
-- row-level security: a signed-in user can only read and write their own rows.
-- The service role (server only) is used solely for the Mono webhook.

create extension if not exists pgcrypto;

-- Profiles -------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  home_currency text not null default 'NGN' check (home_currency in ('NGN', 'USD')),
  pay_gas_in_usdt boolean not null default false,
  wallet_address text check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  agent_id text check (agent_id ~ '^[0-9]{1,78}$'),
  agent_registration_tx text check (agent_registration_tx ~ '^0x[0-9a-fA-F]{64}$'),
  data_source text check (data_source in ('csv', 'sample', 'mono')),
  imported_at timestamptz,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Imported transactions --------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  external_id text not null check (char_length(external_id) <= 120),
  date date not null,
  description text not null check (char_length(description) between 1 and 300),
  merchant text not null check (char_length(merchant) <= 120),
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source text not null check (source in ('csv', 'sample', 'mono')),
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

-- Detected subscriptions -------------------------------------------------------
create table if not exists public.subscriptions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) <= 160),
  merchant text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  category text not null check (char_length(category) between 1 and 40),
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_days integer not null check (interval_days between 1 and 400),
  last_charge date not null,
  next_renewal date not null,
  first_seen date not null,
  charge_count integer not null check (charge_count >= 1),
  total_spent numeric(18, 2) not null,
  history jsonb not null default '[]'::jsonb,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  confidence_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'detected' check (status in ('detected', 'confirmed', 'dismissed')),
  price_change jsonb,
  international boolean not null default false,
  lapsed boolean not null default false,
  payment jsonb,
  edited boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Payments (prepared drafts and on-chain attempts) -----------------------------
create table if not exists public.payments (
  id text primary key check (id ~ '^pay_[a-z0-9]{4,32}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subscription_id text not null,
  merchant text not null,
  source_token text not null check (source_token in ('USDT', 'cNGN')),
  destination_token text not null check (destination_token in ('USDT', 'cNGN')),
  source_amount text not null,
  destination_amount text not null,
  fee_amount text,
  rate text,
  recipient text check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  from_address text check (from_address ~ '^0x[0-9a-fA-F]{40}$'),
  method text not null check (method in ('address', 'x402')),
  rfq_id text,
  status text not null check (status in ('prepared', 'pending', 'confirmed', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);

-- Agent activity ---------------------------------------------------------------
create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question text not null check (char_length(question) <= 2000),
  reply text not null,
  mode text not null check (mode in ('claude', 'local')),
  tools jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_events_user_idx on public.agent_events (user_id, created_at desc);

-- Mono account links -----------------------------------------------------------
create table if not exists public.mono_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ref text not null unique,
  account_id text,
  status text not null default 'initiated'
    check (status in ('initiated', 'connected', 'available', 'partial', 'unavailable', 'failed', 'synced')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mono_links_user_idx on public.mono_links (user_id, created_at desc);

-- updated_at maintenance -------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ declare t text; begin
  foreach t in array array['profiles', 'subscriptions', 'payments', 'mono_links'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Row-level security -------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.agent_events enable row level security;
alter table public.mono_links enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['transactions', 'subscriptions', 'payments', 'agent_events'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Mono links: users may create and read their own; status changes come from the
-- server (webhook / sync) using the service role.
drop policy if exists "own links read" on public.mono_links;
create policy "own links read" on public.mono_links for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own links insert" on public.mono_links;
create policy "own links insert" on public.mono_links for insert to authenticated with check (user_id = (select auth.uid()));
