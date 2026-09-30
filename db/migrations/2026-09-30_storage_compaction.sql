-- MONFLUXO storage compaction
-- Apply only after the Supabase project is writable again.
-- The application now reads token inflows from wallet_transfers and keeps
-- wallet_funding_events for native SOL funding only.

-- Remove duplicated historical TOKEN funding rows.
delete from public.wallet_funding_events
where asset_type = 'TOKEN';

-- These two indexes are not used by current read paths. Wallet-scoped reads
-- use idx_wallet_transfers_wallet_time, while uniqueness is enforced by
-- wallet_transfers_wallet_address_signature_event_index_key.
drop index if exists public.idx_wallet_transfers_mint_time;
drop index if exists public.idx_wallet_transfers_wallet_slot;

-- Refresh planner statistics after the large delete.
analyze public.wallet_funding_events;
analyze public.wallet_transfers;
