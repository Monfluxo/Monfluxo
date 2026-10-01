create table if not exists public.token_price_candles (
  chain text not null default 'solana',
  token_mint text not null,
  interval text not null,
  candle_time timestamptz not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  provider text not null default 'birdeye',
  fetched_at timestamptz not null default now(),
  primary key (chain, token_mint, interval, candle_time)
);

create index if not exists token_price_candles_lookup_idx
  on public.token_price_candles (token_mint, interval, candle_time);

create table if not exists public.wallet_hold_journeys (
  wallet_address text not null,
  token_mint text not null,
  journey_version text not null default 'v1',
  entry_time timestamptz,
  exit_time timestamptz,
  entry_price numeric,
  exit_price numeric,
  hold_seconds bigint,
  realized_roi_pct numeric,
  mfe_pct numeric,
  mae_pct numeric,
  profit_capture_pct numeric,
  missed_upside_pct_points numeric,
  time_to_peak_seconds bigint,
  time_underwater_seconds bigint,
  peak_time timestamptz,
  peak_price numeric,
  trough_time timestamptz,
  trough_price numeric,
  candle_interval text,
  provider text,
  status text not null default 'pending_price_data',
  computed_at timestamptz not null default now(),
  primary key (wallet_address, token_mint, journey_version)
);

create index if not exists wallet_hold_journeys_wallet_idx
  on public.wallet_hold_journeys (wallet_address, computed_at desc);

alter table public.token_price_candles enable row level security;
alter table public.wallet_hold_journeys enable row level security;

revoke all on public.token_price_candles from anon, authenticated;
revoke all on public.wallet_hold_journeys from anon, authenticated;
