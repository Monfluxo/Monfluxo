alter table public.wallet_sync_state
  add column if not exists backfill_pagination_token text,
  add column if not exists backfill_started_at timestamptz,
  add column if not exists backfill_updated_at timestamptz;

comment on column public.wallet_sync_state.backfill_pagination_token is
  'Helius getTransactionsForAddress pagination cursor for resumable historical backfills.';
