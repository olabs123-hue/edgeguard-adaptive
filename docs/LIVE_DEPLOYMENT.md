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
