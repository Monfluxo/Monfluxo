<img width="2172" height="724" alt="MONFLUXO banner" src="https://github.com/user-attachments/assets/8bf37250-6b81-4e12-b36b-a818cafd39e9" />

# MONFLUXO

> **On-chain intelligence for Solana.**

MONFLUXO is building a research and analytics platform designed to turn raw blockchain activity into structured, actionable intelligence.

Instead of simply showing transactions, MONFLUXO is designed to help answer questions like:

- Who is buying and selling?
- Which wallets are consistently profitable?
- How are wallets connected?
- Where is capital moving?
- Are multiple wallets behaving in a coordinated way?
- What patterns are forming around a token?

---

## 🔎 What we're building

### Token Intelligence

Paste a Solana token address and investigate its on-chain activity.

- Buyer and seller analysis
- Wallet profitability and PnL
- New-wallet activity
- Capital flows
- Wallet relationships
- Trading behavior
- Suspicious or coordinated activity signals
- Wallet clustering and bundle-related signals

### 👛 Wallet Intelligence

Go beyond a simple transaction history and build a profile of wallet behavior.

- Historical trades
- PnL and performance
- Best and worst trades
- Trading frequency
- Token exposure
- Hold-time analysis
- Funding and transfer relationships
- Behavioral patterns
- External wallet interactions

### 🧩 On-chain Intelligence Layer

MONFLUXO is designed to connect individual transactions into a broader picture.

The long-term goal is to transform:

`RAW TRANSACTIONS → EVENTS → TRADES / TRANSFERS / REWARDS → POSITIONS → WALLET BEHAVIOR → RELATIONSHIPS → INTELLIGENCE`

This allows the platform to surface patterns that are difficult to identify when looking at blockchain explorers one transaction at a time.

---

## 🏗️ Architecture

The current codebase is organized around a data pipeline that progressively transforms Solana transaction data into higher-level analytics.

```text
Solana
   │
   ▼
Helius / RPC data
   │
   ▼
Transaction Parser
   │
   ▼
Event Model v2
   ├── Trades
   ├── Transfers
   └── Rewards
   │
   ▼
Persistent Wallet Index
   │
   ▼
Position / PnL Engine
   │
   ▼
Wallet Analytics
   │
   ▼
Relationship & Intelligence Layer
   │
   ▼
MONFLUXO
```

### Current core modules

| Module | Purpose |
| --- | --- |
| `src/helius.js` | Solana / Helius data access |
| `src/parser.js` | Transaction classification and event output |
| `src/eventParser.js` | Multi-event trade and transfer reconstruction |
| `src/swapParser.js` | Swap reconstruction and creator-fee detection |
| `src/sync.js` | Incremental/deep wallet indexing |
| `src/db.js` | Supabase/PostgreSQL persistence |
| `src/positionEngine.js` | Inventory, position and PnL logic |
| `src/walletAnalyzer.js` | Wallet-level analytics |

Supporting technical documentation is maintained through the **Architecture** and **Data Model** documents.

---

## 🚧 Current Status

**Early development — core data and intelligence pipeline under construction.**

The first development phase is focused on reliably transforming raw Solana transactions into structured events, trades and positions. Once this foundation is validated against real wallet histories, MONFLUXO will build token analysis and relationship intelligence on top of it.

### Hackathon Roadmap

#### Phase 1 — Data Foundation
- [x] Solana transaction ingestion
- [x] Helius integration
- [x] Initial transaction parser
- [x] Initial swap / trade parsing
- [x] Position engine foundation
- [x] Persistent wallet indexing foundation
- [x] Multi-event transaction model (`trades[]`, `transfers[]`, `rewards[]`)
- [ ] Production migration + historical reindex validation
- [ ] Robust BUY / SELL reconstruction across the validation set

#### Phase 2 — Wallet Intelligence
- [x] Initial historical wallet analytics
- [x] Transfer-aware inventory accounting
- [x] Creator rewards separated from trading PnL
- [ ] Validated realized / unrealized PnL
- [ ] Best / worst trade validation
- [ ] Wallet performance metrics validation
- [ ] Wallet funding and transfer history
- [ ] Wallet behavioral profiles

#### Phase 3 — Token Intelligence
- [ ] Token-level buyer / seller analysis
- [ ] Capital flow analysis
- [ ] New-wallet detection
- [ ] Token holder intelligence
- [ ] Wallet clustering
- [ ] Bundle / coordinated-activity signals

#### Phase 4 — Relationship Intelligence
- [ ] Wallet relationship graph
- [ ] Common funding-source detection
- [ ] Cross-wallet behavioral relationships
- [ ] Coordinated trading detection
- [ ] Intelligence scoring

#### Phase 5 — MONFLUXO Product
- [ ] Token intelligence dashboard
- [ ] Wallet intelligence dashboard
- [ ] Interactive wallet graph
- [ ] AI Analyst
- [ ] Real-time Radar
- [ ] User accounts and monetization

The immediate priority remains **Phase 1 validation**: apply Event Model v2 to the production database, reindex the historical test wallet and explain the remaining unmatched/unknown-cost inventory before moving to the product UI.

---

## 🎯 Hackathon MVP

For the hackathon, MONFLUXO is intentionally focused on a narrow core experience rather than attempting to build the entire platform at once.

The target flow is:

`TOKEN → WALLETS → TRADES → PNL → RELATIONSHIPS → INTELLIGENCE`

The MVP will demonstrate three connected capabilities:

1. **Token Intelligence** — investigate the wallets and activity behind a Solana token.
2. **Wallet Intelligence** — reconstruct a wallet's trading history and performance.
3. **Relationship Intelligence** — identify observable connections and coordinated behavior between wallets.

The goal is to demonstrate that MONFLUXO can move from raw on-chain data to an understandable explanation of what is happening.

---

## 🧱 Transaction Event Model v2

A Solana transaction is not assumed to equal one trade.

MONFLUXO now models one signature as a container for zero or more economic events:

```text
Transaction
   │
   ├── Trade #0
   ├── Trade #1
   ├── Transfer #0
   └── Creator Reward #0
```

The parser exposes:

```js
{
  trades: [],
  transfers: [],
  rewards: []
}
```

`trade` is temporarily retained as an alias for the first trade for backward compatibility with older diagnostics.

Trades are persisted with an `event_index`, allowing multiple BUY/SELL events to share the same Solana signature without overwriting one another.

### Transfer-aware cost basis

Tokens received through a transfer are **not** treated as zero-cost buys. They enter inventory with unknown cost basis until MONFLUXO has evidence establishing their acquisition cost.

When unknown-cost inventory is sold, the proceeds are tracked separately rather than being counted as known realized profit. Wallet analytics expose whether PnL is complete or still contains unknown/unmatched inventory.

---

## 🗄️ Persistent wallet indexing

MONFLUXO does not query an entire wallet history from Helius every time a user opens a wallet. The project includes a PostgreSQL/Supabase persistence layer.

### Data flow

```text
User wallet
   │
   ▼
Incremental / deep sync
   │
   ├── Helius historical data
   ├── Event parser
   └── Derived-event replacement
   │
   ▼
Supabase/PostgreSQL
   │
   ├── wallet_transactions
   ├── wallet_trades
   ├── wallet_transfers
   ├── wallet_rewards
   ├── wallet_sync_state
   └── wallet_analysis_cache
   │
   ▼
Wallet Intelligence
```

The database becomes MONFLUXO's indexed data layer. Helius is the upstream data provider, not the database queried from scratch for every page view.

### Database setup

1. Create/configure the Supabase project.
2. Run the base schema for a new project, or apply the migrations for an existing project.
3. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the backend `.env`.
4. Never expose the service-role key to the browser or commit it to Git.

For an existing MONFLUXO database, apply:

```text
db/migrations/2026-09-28_event_model_v2.sql
```

before running Event Model v2 repair/reindex commands.

### Wallet analysis

Quick scan:

```bash
npm run analyze:wallet -- <WALLET_ADDRESS> quick
```

Deep historical repair/reindex:

```bash
npm run repair:wallet -- <WALLET_ADDRESS>
```

Inspect one transaction under the new event model:

```bash
npm run inspect:events -- <SIGNATURE> <WALLET_ADDRESS>
```

Run focused tests:

```bash
npm test
```

### Protection against huge wallets

The current implementation includes:

- Quick scans with a configurable page limit.
- Deep scans with a separate configurable ceiling.
- Cursor-based incremental synchronization.
- Deduplication using indexed signatures.
- Database persistence of transactions, trades, transfers and rewards.
- Concurrent-sync protection per wallet.
- Helius retry/backoff handling for HTTP 429/503 responses.
- Separate raw-transaction storage control.
- Paginated database reads for wallet analysis.
- User-level daily analysis-limit primitives.
- Usage-event logging for future billing and abuse monitoring.
- Event Model v2 schema validation before reindexing.

### Important production rule

Do **not** let a public endpoint directly perform an unlimited historical Helius scan.

The intended architecture is:

```text
Request
  ↓
Rate limit / plan check
  ↓
Check MONFLUXO database
  ↓
Incremental sync if needed
  ↓
Read indexed data
  ↓
Return analysis
```

A very large wallet should eventually become a queued job rather than one long public HTTP request, allowing the UI to expose a `syncing → ready` lifecycle.

---

## 🎯 Vision

> **Don't just look at the blockchain. Understand it.**

MONFLUXO aims to become a research layer for Solana — turning raw on-chain data into a clearer picture of market participants, wallet behavior, capital movement and emerging activity.

The objective is not to replace a blockchain explorer.

**It is to add the intelligence layer on top of one.**

---

## ⚙️ Development

The project currently runs on Node.js with ES modules.

Create a local `.env` based on `.env.example`, then install dependencies and run the application:

```bash
npm install
npm start
```

---

## 📁 Repository structure

```text
MONFLUXO/
├── db/
│   ├── migrations/
│   └── schema.sql
├── src/
│   ├── db.js
│   ├── eventParser.js
│   ├── helius.js
│   ├── index.js
│   ├── parser.js
│   ├── positionEngine.js
│   ├── swapParser.js
│   ├── sync.js
│   └── walletAnalyzer.js
├── test/
├── Architecture
├── Data Model
├── .env.example
├── package.json
└── README.md
```

---

## Disclaimer

MONFLUXO is an analytics and research project.

Information generated by the platform is intended for informational purposes and should not be considered financial advice.

---

## Project

**MONFLUXO**  
_On-chain intelligence for Solana._
