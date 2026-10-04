-- One compact balance snapshot per wallet, not a growing stream of poll snapshots.
create table public.wallet_initial_holdings (
 wallet_address text primary key,
 captured_at timestamptz not null,
 snapshot_kind text not null check (snapshot_kind in ('scan_start','first_recorded')),
 slot_from bigint,
 slot_to bigint,
 native_lamports bigint not null check (native_lamports >= 0),
 token_count integer not null check (token_count >= 0),
 balances jsonb not null check (jsonb_typeof(balances) = 'array' and jsonb_array_length(balances) = token_count)
);
alter table public.wallet_initial_holdings enable row level security;
revoke all on public.wallet_initial_holdings from public, anon, authenticated;
grant select, insert, delete on public.wallet_initial_holdings to service_role;
comment on table public.wallet_initial_holdings is 'First verified balances; existing indexed wallets explicitly use first_recorded, never backdated scan_start. No metadata or transaction payloads.';
