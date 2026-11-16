# Deploy public Worker demonstration

The current code can deploy as a **safe public demonstration** with `/` and `/healthz`. Proxy forwarding remains disabled until trusted HTTPS origins and a secret are deliberately configured.

## Deploy

```bash
cd worker
npm install
npm run typecheck
npm test
npx wrangler login
npx wrangler deploy
```

Wrangler prints the real `*.workers.dev` deployment URL. Verify `/` returns project JSON, `/healthz` returns `ok`, and an arbitrary route returns `503 origins_not_configured`.

**Never commit Cloudflare API tokens.** Keep `ORIGIN_URLS` empty for the public portfolio demo.

## Later: authenticated origin forwarding

Set `ORIGIN_URLS` in `wrangler.toml` to a trusted HTTPS origin root you own (for instance `https://origin.your-domain.example`, replacing the placeholder). Create a secret with:

```bash
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

A request to a proxied route requires `Authorization: Bearer <API_TOKEN>`. Use Cloudflare Access / network controls for serious deployments. Never expose arbitrary target-URL forwarding.

## Optional: Queues

Create both named queues, then uncomment producer and consumer blocks in `wrangler.toml` and redeploy:

```bash
npx wrangler queues create edgeguard-reliability
npx wrangler queues create edgeguard-reliability-dlq
npx wrangler deploy
```

The queue consumer **only validates and logs** events. It is not a reliable analytics database or an exactly-once execution system.

No public Worker deployment is claimed until the URL is retrieved and verified after authenticating to a Cloudflare account.

## Deploy directly from GitHub Actions (no local terminal)

A manually triggered workflow is available at [Actions → Deploy Cloudflare Worker](https://github.com/olabs123-hue/edgeguard-adaptive/actions/workflows/deploy-cloudflare.yml). It does **not** deploy on pushes.

1. In [Cloudflare](https://dash.cloudflare.com/), locate your **Account ID**.
2. Create a Cloudflare API token with sufficient Workers deployment permissions. For first-time Worker creation, Cloudflare's current permission model requires the relevant product-level Admin scope. Restrict the token to your account, and keep it private.
3. In [GitHub repository Actions secrets](https://github.com/olabs123-hue/edgeguard-adaptive/settings/secrets/actions), set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use GitHub's **New repository secret** UI; never paste the token into chats, source or logs.
4. Open the [Deploy Cloudflare Worker workflow](https://github.com/olabs123-hue/edgeguard-adaptive/actions/workflows/deploy-cloudflare.yml), click **Run workflow**, select `main`, and run.
5. Check the run summary for the published `workers.dev` address. Confirm `/healthz` responds `ok`, and that unrelated paths fail closed until trusted origins are configured.

The workflow checks Worker tests and requires `ORIGIN_URLS = ""` before publishing the public demo. It uses `cloudflare/wrangler-action@v4` and requires Cloudflare credentials that the owner must set themselves. Configure the optional GitHub environment `cloudflare-production` with approval rules if you want manual deployment approval.

The GitHub repository's `GITHUB_TOKEN` **cannot** substitute for a Cloudflare API token. A successful GitHub CI run does not establish that a Worker has been deployed.
