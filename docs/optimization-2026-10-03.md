# Optimization rollout — 2026-10-03

## Implemented
- Algorithm-version and source-checkpoint validation for analysis cache. Complete wallets no longer inherit the quick 5,000-trade limit. Explicit truncation prevents final-confidence claims.
- A compact persisted intelligence snapshot reuses the existing FIFO computation for accounting review, holding behavior, summary, scoring and ranked journey summaries. It stores open inventory totals, not raw transactions or full execution histories.
- Dashboard live holdings and portfolio valuation share one bounded, single-flight DAS cache (30 seconds). Metadata, cluster and behavioral results share bounded caches; response cloning prevents price/UI enrichment from mutating cached data.
- Journey and position reconstruction use the same deduplicated, ordered accounting events. Transfers and creator rewards participate in inventory consumption. Transferred-out lifecycles are excluded from sale rankings; external inventory never becomes zero-cost trading profit.
- Exact journey detail queries filter by mint in the database instead of loading all wallet trades; transfer/reward history is included.
- Worker metric refreshes are read-only: no second history download after each slice or completion.
- Event slots are propagated to stored trade, transfer and reward rows. Invalid numeric timestamps become unknown; reward timestamps may be null.
- Page facts and deep resume checkpoint persist in one service-only SQL transaction. Obsolete event keys are removed; unchanged facts are not rewritten. Derived journey replacement is atomic and skips unchanged rows, cleaning obsolete/legacy rankings only after a complete reconstruction.
- RLS and service-only grants protect journey/score tables and persistence RPCs. Administrative telemetry requires the admin key. Public requests cannot choose indexing priority.
- Helius/PostgREST requests have timeouts. Full history page size is configurable up to 1,000; default remains 100 until plan capability is verified. Version-0 parsed transactions are explicitly requested. Credits remain transaction-based.

## Verification
87 Node tests pass. Production SQL rollback test confirms partial writes and cursor changes cannot survive a failed page; repeating an unchanged transaction preserves its tuple. Anonymous roles cannot write derived tables or execute persistence RPCs; service role can.

## Remaining work and limits
- No physical compaction, wholesale fact deletion, subscription purchase, or retirement of web-v3. Physical reclamation needs a planned maintenance operation with verified headroom and backup.
- Existing historical facts with missing slots are not bulk rewritten. The new parser preserves slots on future ingestion/repair.
- OFFSET pagination remains in full-wallet reconstruction; the persisted snapshot substantially reduces how often it runs. Keyset pagination requires a separate indexed cursor rollout.
- Account-based billing and distributed user quotas remain separate from the existing wallet transaction budgets. No paid credits are charged by this change.
- getTransfersByAddress is not substituted for full swap/reward transaction parsing. Creator-revenue timeline pagination and cross-provider request budgeting still need separate changes.
- Rankings require analysis version 3. Existing complete wallets must be reconstructed once, using the canonical backfill service/script or their next dashboard visit; old derived rows are not advertised as freshly validated rankings.
- Supabase's informational no-RLS-policy notices are expected for backend-only tables. The existing publicly callable aggregate command-stats function is unchanged; it is not one of the new persistence RPCs.

Follow-up: existing incomplete wallets rebuild metrics read-only while the worker handles history. Positive stablecoin transfers are retained for accounting instead of dropping outflows at the database writer. Live PnL totals cover displayed known-cost holdings and stay unknown when no basis is available. Worker startup refreshes only outdated complete-wallet snapshots in the background, without Helius history requests.
