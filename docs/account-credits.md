# Private beta accounts and credits

Pro costs US$29 per 30-day cycle and grants 50 subscription credits. Beta invitations grant 50 free credits with a common expiry 14 days after the beta starts. Admin can schedule the start before accounts are activated; if no date is scheduled, the first participant activation starts the shared clock. Late participants receive the same deadline. A private invitation is a reusable login credential, stored only as SHA-256 in the database; it does not replenish credits on subsequent sign-ins. Admin can create up to 25 active invitation codes at `/admin`, under Private beta & credits, using the existing admin key. Codes are returned once; do not place them in URLs, logs or repository files.

The header displays spendable credits. Its modal shows subscription balance out of 50, purchased credits, reservations, cycle expiry, transaction pricing, permanent account wallet unlocks and the latest 20 ledger movements. Sessions use random 256-bit tokens, hashes in PostgreSQL, and HttpOnly/Secure/SameSite=Strict browser cookies. Server proxies forward only that session, never the Supabase service key. Wallet dashboard, progress, incoming flows, creator revenue and Trade Intelligence enforce the entitlement in the backend when `MONFLUXO_CREDITS_ENABLED=true`.

## Charging

- New wallet: reserve 3 credits for up to 5,000 historical transactions. Debit atomically with the first saved history checkpoint; retries do not debit again.
- Existing wallet indexed by another account: 1 credit once. Further openings, GET refreshes and metadata enrichment do not bill.
- Extend a paused wallet by 2,000 transactions: reserve 1 credit; charge using the cumulative saved count, not provider page count. The API also supports a 10,000-transaction extension for 5 credits.
- Insufficient balance includes other pending reservations. PostgreSQL account row locks serialize concurrent spending, and a unique partial index prevents concurrent paid requests for the same wallet.
- A terminal index failure releases unspent reservations. A failure before any saved transactions removes provisional ownership and spends nothing. Saved partial work remains billed and visible. Transient retries retain reservations.
- History exhaustion releases the unused part of an extension. No full scan restarts and no unlimited re-indexing allowance.
- An active cycle is required even when revisiting a wallet free. Wallet unlocks survive renewal. Renewal replaces cycle balance with 50, and purchased credits expire at the end of their purchase cycle. Renewal is refused while paid indexing is pending.

## Purchases

The purchase button creates a pending request for 10 credits / US$5, available only to active Pro accounts. There is no automatic payment provider configured yet. The UI explicitly asks the participant to contact MONFLUXO to complete payment. Admin confirms receipt using an actual unique payment reference; until then no credits are granted. Pro activation/renewal is also manually confirmed. Payment references are shared by subscription and pack fulfillment, preventing duplicate fulfillment across both types. Do not confirm orders or activate Pro without checking payment.

## Historical indexing

Railway worker is configured with `HELIUS_FULL_PAGE_LIMIT=1000`: deep indexing returns up to 1,000 full transactions per request. Quick and incremental calls deliberately request 100. Changing the provider page size does not change credit thresholds. `walletPolicyIntegration.test.js` verifies 5,000 deep transactions require 5 pages with this setting, exact remaining allowance, and small foreground requests. Real continuation benchmark indexed 20,000 new transactions in 20 calls; see `continuation32000-2026-10-03.md`.

## Validation

`npm test` covers session rejection, disabled/expired accounts, entitlement gating on every wallet endpoint, spendable balances with reservations, malformed invitation credentials, and prior journey/indexing regressions. `test/sql/credit_integration.sql` runs on the migrated database in a transaction that ends in ROLLBACK: it verifies login without replenishment, shared 14-day beta expiry, provisional reservation, duplicate requests/checkpoints, unlock once, extension rounding, terminal refunds, insufficient balance, renewal, payment idempotence and private database grants. No fixture data is retained. A separate parallel database test used a 1-credit account and two distinct saved wallets: one unlock succeeded, one failed for insufficient credits, and the ledger contained exactly one debit; temporary fixtures were removed.

Apply all credit migrations before enabling the API flag. Backend continues to serve the public landing page and public top trade previews. Use `/api/credits/login` on the frontend to activate an invitation; POST requests enforce same-origin. Admin API requires `X-Monfluxo-Admin-Key` and never injects that secret from web server configuration.
