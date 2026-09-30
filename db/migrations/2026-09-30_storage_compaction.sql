-- MONFLUXO storage compaction
-- Apply only after the Supabase project is writable again.
-- The application now reads token inflows from wallet_transfers and keeps
-- wallet_funding_events for native SOL funding only.

-- Remove duplicated historical TOKEN funding rows.
delete from public.wallet_funding_events
where asset_type = 'TOKEN';

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

-- These two indexes are not used by current read paths. Wallet-scoped reads
-- use idx_wallet_transfers_wallet_time, while uniqueness is enforced by
-- wallet_transfers_wallet_address_signature_event_index_key.
drop index if exists public.idx_wallet_transfers_mint_time;
drop index if exists public.idx_wallet_transfers_wallet_slot;

-- Refresh planner statistics after the large deletes.
analyze public.wallet_funding_events;
analyze public.wallet_transfers;
