# MONFLUXO Private Beta Deployment

Target architecture:

```text
Vercel
└── Next.js frontend (`web/`)

Railway
├── API service (`npm run start:api`)
└── Index worker (`npm run start:worker`)

Supabase
└── persistent indexed wallet data

Helius
└── RPC / DAS / historical data
```

## 1. Backend API service (Railway)

Create a service from this repository and use `deploy/railway-api.toml` as the Railway config path.

Required environment variables:

- `HELIUS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `MONFLUXO_WEB_ORIGIN=https://<vercel-domain>,https://beta.monfluxo.com`

Optional variables are documented in `.env.example`.

Railway supplies `PORT`; do not hardcode it in production.

Health endpoint:

```text
GET /health
```

Expected payload:

```json
{"ok":true,"service":"monfluxo-api"}
```

## 2. Historical index worker (Railway)

Create a second service from the same repository and use `deploy/railway-worker.toml` as its config path.

Use the same backend environment variables as the API service. This service has no public port and must stay running continuously.

The worker consumes `wallet_index_jobs` from Supabase and performs resumable historical indexing.

## 3. Frontend (Vercel)

Import the same GitHub repository into Vercel.

Set the Vercel project root directory to:

```text
web
```

Required server-side environment variable:

```text
MONFLUXO_BACKEND_URL=https://<railway-api-domain>
```

Do not expose Supabase service-role or Helius private keys to the frontend.

Once deployed, add the Vercel production/preview domain to `MONFLUXO_WEB_ORIGIN` on the Railway API service and redeploy the API.

## 4. Beta domain

Recommended first rollout:

```text
beta.monfluxo.com -> Vercel
api-beta.monfluxo.com -> Railway API (optional)
```

The browser normally talks to Next.js proxy routes, so the Railway hostname does not need to be user-facing.

## 5. Pre-beta checks

Before inviting testers:

1. Verify `/health` on Railway.
2. Verify the worker is continuously polling and processing queued wallets.
3. Analyze one small wallet, one large wallet, one creator wallet, and one wallet funded by a known service.
4. Confirm the UI transitions `queued/indexing -> complete` without manual intervention.
5. Confirm token images degrade to initials rather than breaking the page.
6. Confirm incoming SOL and SPL funding appear in Relevant Incoming Flows.
7. Confirm dust funding does not become Wallet Origin or cluster evidence.
8. Confirm CEX/protocol labels are excluded from cluster scoring when resolved.
9. Confirm no secret values are present in client bundles or logs.
10. Keep the first rollout private (5–10 testers) until Helius usage and worker throughput are observed.

## 6. Production commands

Railway API:

```bash
npm run start:api
```

Railway worker:

```bash
npm run start:worker
```

Local development continues to use the `.env`-aware commands:

```bash
npm run api
npm run worker:index
```

## 7. Rollback

If a beta deployment becomes unstable, stop the worker first to avoid additional indexing load, then roll the API/frontend back to the prior successful Git commit. Supabase indexed data is persistent and should not require rollback for ordinary application releases.
