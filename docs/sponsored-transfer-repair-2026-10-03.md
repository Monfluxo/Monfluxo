# Sponsored transfer repair — 2026-10-03

Production cleanup completed for 342 transactions with original on-chain evidence.
342 false SELL rows were removed; 342 outgoing token transfers were inserted;
342 transaction summaries were reclassified to TRANSFER_OUT. The operation was
one atomic SQL statement: deletion depended on INSERT RETURNING, so a failed
preservation or conflicting event key could not authorize deletion. No existing
transfer rows were deleted. Original raw transactions remain available.

Verification after commit: 342 repair-tagged transfers; zero missing source or
destination token accounts. A recipient owner absent from the transaction remains
null rather than being guessed. Stablecoin transfers were also preserved.
Affected analysis caches and smart scores were invalidated; affected token journey
rows were invalidated (zero trade journey rows actually existed for this batch).

Eligibility requires a successful original transaction, wallet account index > 0,
unchanged wallet SOL balance, no current parser trade/reward, and an explicit SPL
transfer with source owned by the wallet, matching mint and exact raw amount.
The verifier supports compiled base58 Transfer/TransferChecked instructions and
parsed instructions and zero-fee Token-2022 TransferCheckedWithFee. Burns, nonzero Token-2022 transfer fees,
ambiguous/multiple matches, absent metadata and actual SOL receipts are excluded.
Tests cover preservation, null timestamps, real SOL receipts, failed transactions,
burns, amount mismatches and absent wallet keys. Full suite: 67 passed.

## Remaining work

Initial candidate snapshot: 639,137 fee-sized instruction_swap SELL transaction
signatures, of which 342 had original raw data. Of these 342, 342 were verified
and repaired, including 20 Token-2022 TransferCheckedWithFee transactions
with an explicitly verified zero token fee. Approximately 638,795 candidate signatures remain from
that snapshot; candidates are not confirmed false sales. Most lack raw data.
Do not delete them just because sale SOL equals network fee.

Railway returns HELIUS_API_KEY values redacted through the connected API, so this
session could not run a complete authenticated on-chain replay. A subsequent
repair must run where the Helius key is already configured, fetch original
transactions in bounded batches, apply this verifier and preserve transfers
transactionally before deleting matching false sales. Checkpoint successful
signatures and retry provider failures; never mark unverified rows repaired.

## Helius performance and costs

Official sources checked 2026-10-03:
- https://www.helius.dev/docs/billing/plans
- https://www.helius.dev/docs/billing/credits
- https://www.helius.dev/docs/rpc/gettransfersbyaddress
- https://www.helius.dev/docs/wallet-api/transfers

Developer costs USD 49/month, with 10M credits and 50 RPC requests/s,
versus Free's 1M credits and 10 RPC requests/s. Five times the RPC rate is a
ceiling on throughput improvement, not a measurement of single-wallet latency.
Sequential cursors, network latency, parsing, metadata and Postgres still cost time.
If RPC waiting is 50% of runtime, making that portion 5x faster yields 1.67x
overall; if 80%, 2.78x. These are illustrative Amdahl models, not benchmarks.

getTransfersByAddress requires Developer+, costs 10 credits/request and returns
up to 100 transfer events. It returns concise normalized SOL/SPL records,
instruction positions, counterparties, and explicit mint/burn/Token-2022 cases.
Transfer history does not itself establish swaps, proceeds or PnL; fetch original
transactions for ambiguous trades and reconcile against transfer legs without
double-counting swap legs as independent funding events.

5,000 transfer events need at least 50 full pages / 500 provider credits;
these are events, not necessarily 5,000 distinct transactions. 5M transfer events
need at least 50,000 pages / 500,000 credits. Cursor chaining prevents multiplying
one sequential history scan directly by the headline RPS limit.

Wallet REST Transfers is a distinct beta API, included on Free, priced at
100 credits/request, also up to 100 events/page. Prefer the RPC endpoint when
available. getTransactionsForAddress now supports up to 1,000 full transactions;
metering is 10 credits per 100 returned, rounded up. MONFLUXO currently uses
100/page; changing this requires preserving transaction budget accounting and
legacy checkpoint semantics. The 5,000 transaction example costs at least 500
credits for full history, before metadata, retries or other lookups.

Deleting records makes database pages reusable; it does not automatically shrink
the physical database file. No VACUUM FULL or global rewrite was performed.

Token-2022 instruction layout verified against official source:
https://github.com/solana-program/token-2022/blob/main/interface/src/extension/transfer_fee/instruction.rs
