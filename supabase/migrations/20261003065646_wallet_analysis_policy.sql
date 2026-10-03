create table if not exists public.wallet_analysis_policies (
 wallet_address text primary key check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 action text not null default 'allow' check (action in ('allow','block','exclude','review')),
 transaction_limit integer not null default 5000 check (transaction_limit between 5000 and 50000),
 name text, category text, reason text not null default 'Bounded analysis',
 source text not null default 'manual' check (source in ('manual','helius_preflight')),
 checked_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.wallet_analysis_policies enable row level security;
revoke all on public.wallet_analysis_policies from anon, authenticated;
grant select, insert, update, delete on public.wallet_analysis_policies to service_role;
alter table public.wallet_sync_state add column if not exists transactions_scanned bigint check (transactions_scanned >= 0);
-- Work counters are not billing: legacy rows keep NULL and use a conservative page estimate.
-- An atomic lease prevents concurrent API/worker requests from spending the same allowance.
create or replace function public.try_wallet_sync_lease(p_wallet text) returns boolean
language plpgsql security invoker set search_path = public as $$
declare acquired boolean;
begin
 insert into public.wallet_sync_state(wallet_address,status,updated_at) values(p_wallet,'idle',now()) on conflict(wallet_address) do nothing;
 with claimed as (
  update public.wallet_sync_state set status='syncing',updated_at=now()
  where wallet_address=p_wallet and status is distinct from 'syncing' returning wallet_address
 ) select exists(select 1 from claimed) into acquired;
 return acquired;
end;
$$;
revoke all on function public.try_wallet_sync_lease(text) from public, anon, authenticated;
grant execute on function public.try_wallet_sync_lease(text) to service_role;
