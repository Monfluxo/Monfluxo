set lock_timeout = '2s';
-- Current services query trades by wallet; no token-wide query uses this index.
-- Restore if needed: CREATE INDEX idx_wallet_trades_token ON public.wallet_trades (token_mint, block_time DESC);
drop index if exists public.idx_wallet_trades_token;
