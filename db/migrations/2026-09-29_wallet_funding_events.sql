create table if not exists public.wallet_funding_events (
  wallet_address text not null references public.wallets(address) on delete cascade,
  signature text not null,
  event_index integer not null default 0,
  slot bigint,
  block_time timestamptz,
  asset_type text not null check (asset_type in ('SOL','TOKEN')),
  asset_id text not null,
  amount numeric not null check (amount >= 0),
  raw_amount numeric not null check (raw_amount >= 0),
  decimals integer not null default 0,
  source_address text,
  destination_address text,
  source_token_account text,
  destination_token_account text,
  parser text,
  created_at timestamptz not null default now(),
  primary key (wallet_address, signature, event_index, asset_id)
);

create index if not exists wallet_funding_events_wallet_time_idx
  on public.wallet_funding_events(wallet_address, block_time desc, slot desc);

create index if not exists wallet_funding_events_source_idx
  on public.wallet_funding_events(source_address)
  where source_address is not null;

alter table public.wallet_funding_events enable row level security;
revoke all on table public.wallet_funding_events from anon, authenticated;
grant select, insert, update, delete on table public.wallet_funding_events to service_role;

-- Existing external token transfers are already normalized in wallet_transfers.
insert into public.wallet_funding_events (
  wallet_address, signature, event_index, slot, block_time,
  asset_type, asset_id, amount, raw_amount, decimals,
  source_address, destination_address,
  source_token_account, destination_token_account, parser
)
select
  wallet_address, signature, event_index, slot, block_time,
  'TOKEN', token_mint, token_amount, raw_amount, decimals,
  source_address, destination_address,
  source_token_account, destination_token_account, parser
from public.wallet_transfers
where direction = 'IN'
on conflict (wallet_address, signature, event_index, asset_id) do update
set amount = excluded.amount,
    raw_amount = excluded.raw_amount,
    decimals = excluded.decimals,
    source_address = excluded.source_address,
    destination_address = excluded.destination_address,
    source_token_account = excluded.source_token_account,
    destination_token_account = excluded.destination_token_account,
    parser = excluded.parser,
    slot = excluded.slot,
    block_time = excluded.block_time;

-- Best-effort historical SOL funding backfill from stored parsed transactions.
with outer_sol as (
  select
    wt.wallet_address,
    wt.signature,
    wt.slot,
    wt.block_time,
    (i.ordinality - 1)::int * 1000 as event_index,
    i.instruction #>> '{parsed,info,source}' as source_address,
    i.instruction #>> '{parsed,info,destination}' as destination_address,
    nullif(i.instruction #>> '{parsed,info,lamports}','')::numeric as lamports
  from public.wallet_transactions wt
  cross join lateral jsonb_array_elements(
    coalesce(wt.raw_transaction #> '{transaction,message,instructions}', '[]'::jsonb)
  ) with ordinality as i(instruction, ordinality)
  where wt.raw_transaction is not null
    and coalesce(i.instruction->>'program','') = 'system'
    and i.instruction #>> '{parsed,type}' = 'transfer'
)
insert into public.wallet_funding_events (
  wallet_address, signature, event_index, slot, block_time,
  asset_type, asset_id, amount, raw_amount, decimals,
  source_address, destination_address, parser
)
select
  wallet_address, signature, event_index, slot, block_time,
  'SOL', 'SOL', lamports / 1000000000.0, lamports, 9,
  source_address, destination_address, 'system_transfer'
from outer_sol
where destination_address = wallet_address
  and source_address is distinct from wallet_address
  and lamports > 0
  and not exists (
    select 1 from public.wallet_trades t
    where t.wallet_address = outer_sol.wallet_address
      and t.signature = outer_sol.signature
  )
  and not exists (
    select 1 from public.wallet_rewards r
    where r.wallet_address = outer_sol.wallet_address
      and r.signature = outer_sol.signature
  )
on conflict (wallet_address, signature, event_index, asset_id) do update
set amount = excluded.amount,
    raw_amount = excluded.raw_amount,
    source_address = excluded.source_address,
    destination_address = excluded.destination_address,
    slot = excluded.slot,
    block_time = excluded.block_time,
    parser = excluded.parser;
