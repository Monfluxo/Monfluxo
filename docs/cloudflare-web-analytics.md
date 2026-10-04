# Cloudflare Web Analytics activation

The beacon is prepared but remains disabled until CLOUDFLARE_WEB_ANALYTICS_TOKEN is set on the Railway web-v4 service and the frontend is rebuilt/deployed.

In Cloudflare Web Analytics, add monfluxo.com and use manual JavaScript installation. Copy the public site token from Manage site. This is the beacon token, not an API credential. DNS-only is supported; no proxy change is required.

The frontend loads the beacon after interaction for /, /beta and /data. It does not inject it on admin/login, admin or wallet detail routes. Automatic SPA tracking is disabled to avoid following private routes; full document loads are measured. If client-side routing is added later, revisit tracking and exclusions before enabling SPA tracking.

Do not enable automatic Cloudflare injection as well as manual injection: that can duplicate metrics. Statistics appear in Cloudflare Web Analytics, not in MONFLUXO admin. Verify a pageview in Cloudflare after activation. Ad blockers can prevent collection.
