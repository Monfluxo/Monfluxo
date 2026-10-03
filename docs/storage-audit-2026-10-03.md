# Wallet admission and storage audit — 2026-10-03

Production project: iklxvcjgkdfgbahtlebr. Counts and sizes are a snapshot, not a growth forecast.

## Storage

Database before optimization: 1,481,378,963 bytes (1,413 MiB / 1.48 GB).
After removing the unused token-wide trade index: 1,389,259,923 bytes (1,325 MiB / 1.39 GB).
Recovered: 92,119,040 bytes (87.85 MiB). No transaction/event rows were deleted.

Largest relations before the change, including indexes:

| Relation | MiB | Live row estimate |
| --- | ---: | ---: |
| wallet_trades | 651 | 796,047 |
| wallet_transactions | 359 | 810,297 |
| wallet_transfers | 305 | 517,462 |
| wallet_funding_events | 62 | 90,129 |
| wallet_trade_journeys | 21 | 32,214 |

Trade indexes accounted for ~400 MiB. The removed `idx_wallet_trades_token` had zero recorded scans, no constraint dependency and no corresponding token-wide query in the current services. Wallet-time, wallet-slot, primary-key and unique event indexes remain. The migration contains the restoration SQL.

Raw JSON is not the principal growth source: 754 rows with ~3.6 MiB of raw payload. Only BUY, SELL, TRANSFER_OUT and CREATOR_FEE_CLAIM summaries are retained. Defaults in sync and repair now require explicit `STORE_RAW_TRANSACTIONS=true`; workers already opted in explicitly. Distinct trade event keys had zero duplicates. Low dead-row counts do not justify a blocking VACUUM FULL or bulk reindex.

## Concentrated and questionable history

Wallet `u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w` accounts for 636,544 trade events, 636,555 transaction summaries and 235,017 transfers. All its trades are SELL / unknown DEX / instruction_swap, and every recorded sale amount equals the transaction fee. Trade creation dates: 62,097 rows on 2026-10-02 and 574,447 on 2026-10-03 (UTC). These rows and indexes explain a substantial part of the growth; the exact earlier 400 MB snapshot was not available for a direct before/after comparison.

Verified sample: signature `51vNjJjcP4AoReKPazn1DqTP2uu3vyyTPb1i39MBddF4ZQCMEeJxWgrarb2VKrS53AaCPwTdn4NDdRShNuGPpQmu`, fetched read-only from Solana mainnet RPC. Wallet account index=1; fee=110,000 lamports; wallet SOL delta=0; programs System, ComputeBudget and SPL Token. The old fallback added somebody else's network fee to the unchanged wallet balance, fabricating SELL proceeds. The repaired parser yields TRANSFER_OUT, zero trades and one transfer.

Both BUY and SELL balance fallbacks now adjust only fees paid by account index 0. Regressions cover sponsored transfers, sponsored buys/sells and wallet-paid sales. Existing suspicious records have not been mass deleted or blindly reclassified: one verified signature does not establish the correct classification of every historical event. They need bounded replay/archive with preservation of legitimate transfer events before cleanup; a future cleanup must also invalidate derived caches/journeys/scores and account for physical reclamation of freed table pages. Merely deleting rows does not necessarily return disk space immediately.

## Admission behavior

Automatic high-activity reviews from Helius preflight become bounded allow policies with a visible warning. Manual reviews, confirmed entity blocks and configured limits remain effective. Manual reviews allow viewing stored metrics and rebuilding metrics from persisted events but cannot enqueue new history. Confirmed blocks remain blocked. Complete, budget-paused and reviewed histories can be read without history download; complete cache misses are computed from persisted events. Repeated reads cannot refill transaction allowances.

## Verification

61 Node tests passed, Next production build passed. The real sampled transaction changed from false SELL to TRANSFER_OUT. Production index absence and database-size reduction were verified directly. Full historical cleanup has not been performed.
