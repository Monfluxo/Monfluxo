-- MONFLUXO storage compaction
-- Apply only after the Supabase project is writable again.
-- The application now reads token inflows from wallet_transfers and keeps
-- wallet_funding_events for material native SOL funding only.

-- Remove duplicated historical TOKEN funding rows.
delete from public.wallet_funding_events
where asset_type = 'TOKEN';

-- Native SOL dust is not useful for Wallet Origin or Cluster Intelligence.
-- 0.001 SOL is aligned with MIN_WALLET_ORIGIN_SOL / MIN_NATIVE_SOL_FUNDING.
delete from public.wallet_funding_events
where asset_type = 'SOL'
  and coalesce(amount, 0) < 0.001;

-- Stablecoin dust dominated wallet_transfers in the prototype dataset.
-- Keep only material inbound USDC/USDT funding; trades remain represented in
-- wallet_trades and do not depend on these transfer rows.
delete from public.wallet_transfers
where token_mint in (
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYDCLjv5Az5p7TYE3p3w8uJ'
)
and (
  direction <> 'IN'
  or coalesce(token_amount, 0) < 5
);

-- Remove malformed / economically empty transfer facts. We deliberately do
-- not use an arbitrary amount floor for non-stable tokens because decimals and
-- token economics vary widely; relevance pruning is handled by the indexer.
delete from public.wallet_transfers
where token_mint is null
   or direction not in ('IN', 'OUT')
   or token_amount is null
   or token_amount <= 0;

-- wallet_transactions is only a compact transaction-summary/evidence layer.
-- The canonical trading, transfer, reward and native-funding facts live in
-- their dedicated event tables. Keep only summaries that are useful for
-- economic diagnostics; sync cursors/timestamps live in wallet_sync_state.
delete from public.wallet_transactions
where parsed_type is null
   or parsed_type not in ('BUY', 'SELL', 'TRANSFER_OUT', 'CREATOR_FEE_CLAIM');

-- These indexes are not used by current production read paths.
drop index if exists public.idx_wallet_transfers_mint_time;
drop index if exists public.idx_wallet_transfers_wallet_slot;
drop index if exists public.idx_wallet_transactions_block_time;

-- Refresh planner statistics after the large deletes.
analyze public.wallet_funding_events;
analyze public.wallet_transfers;
analyze public.wallet_transactions;
