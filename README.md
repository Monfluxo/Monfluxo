<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/8bf37250-6b81-4e12-b36b-a818cafd39e9" />


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

`RAW TRANSACTIONS → TRADES → POSITIONS → WALLET BEHAVIOR → RELATIONSHIPS → INTELLIGENCE`

This allows the platform to surface patterns that are difficult to identify when looking at blockchain explorers one transaction at a time.

---

## 🏗️ Architecture

The current codebase is organized around a data pipeline that progressively transforms Solana transaction data into higher-level analytics.

```
Solana
   │
   ▼
Helius / RPC data
   │
   ▼
Transaction Parser
   │
   ▼
Swap / Trade Reconstruction
   │
   ▼
Position Engine
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
| `src/parser.js` | Raw transaction parsing |
| `src/swapParser.js` | Swap and trade reconstruction |
| `src/positionEngine.js` | Position and PnL logic |
| `src/index.js` | Application entry point |

Supporting technical documentation is also maintained in the repository through the **Architecture** and **Data Model** documents.

---

## 🚧 Current Status

**Early development — core data and intelligence pipeline under construction.**

The first development phase is focused on reliably transforming raw Solana transactions into structured trades and positions. Once this foundation is stable, MONFLUXO will build persistent wallet intelligence, token analysis and relationship detection on top of it.

### Hackathon Roadmap

#### Phase 1 — Data Foundation
- [x] Solana transaction ingestion
- [x] Helius integration
- [x] Initial transaction parser
- [x] Initial swap / trade parsing
- [x] Position engine foundation
- [ ] Robust BUY / SELL reconstruction
- [ ] Persistent wallet indexing

#### Phase 2 — Wallet Intelligence
- [ ] Historical wallet analytics
- [ ] Accurate realized / unrealized PnL
- [ ] Best / worst trade analysis
- [ ] Wallet performance metrics
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

The immediate priority is **Phase 1**: make the underlying transaction and trade data reliable enough to support everything above it.

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

## 🎯 Vision

> **Don't just look at the blockchain. Understand it.**

MONFLUXO aims to become a research layer for Solana — turning raw on-chain data into a clearer picture of market participants, wallet behavior, capital movement and emerging activity.

The objective is not to replace a blockchain explorer.

**It is to add the intelligence layer on top of one.**

---

## ⚙️ Development

The project currently runs on Node.js with ES modules.

### Environment

Create a local `.env` file based on `.env.example`.

Then install dependencies:

```bash
npm install
```

Run the application:

```bash
npm start
```

---

## 📁 Repository structure

```
MONFLUXO/
├── src/
│   ├── helius.js
│   ├── index.js
│   ├── parser.js
│   ├── positionEngine.js
│   └── swapParser.js
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
