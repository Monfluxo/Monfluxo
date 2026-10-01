# MONFLUXO Web

Wallet Intelligence frontend for the `wallet-intelligence.v1` API contract.

## Local development

Run the backend API from the repository root:

```bash
npm run api
```

The API listens on `http://localhost:3000` by default.

In a second terminal:

```bash
cd web
cp .env.example .env.local
npm install
npm run dev -- -p 3001
```

Open:

```text
http://localhost:3001
```

The frontend calls:

```text
GET http://localhost:3000/api/wallet/:address
```

When historical indexing is incomplete, the dashboard automatically refreshes the wallet every 12 seconds while the API reports `indexing.refreshRecommended = true`.

## Environment

```text
NEXT_PUBLIC_MONFLUXO_API=http://localhost:3000
```

The backend allows `http://localhost:3001` by default through `MONFLUXO_WEB_ORIGIN`. For another frontend origin, configure that variable in the backend `.env`.
