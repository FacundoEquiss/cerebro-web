**English** · [Español](deploy.es.md)

# Hosting

Cerebro Web is a plain Next.js application: it runs wherever Node 22 runs. Nothing in it depends
on one hosting company.

Two things are true everywhere:

- `NEXT_PUBLIC_*` variables (`NEXT_PUBLIC_SITE_URL` in particular), `APP_ENV` and `ALLOW_INDEXING`
  are read at **build** time too, because pages are pre-rendered with them (canonical URLs,
  `noindex`). Set them before `npm run build`, and build again when one changes.
- "Production" — the real store, where measurement and indexing may switch on — is
  `APP_ENV=production` (detected on its own on Vercel).

## Any Node server (a VPS, a home server)

```bash
git clone <your repository> store && cd store
npm ci
cp .env.example .env.local      # fill it in
npm run build
npm start                       # next start, port 3000 (PORT=8080 npm start for another one)
```

Keep it running with your process manager (a systemd unit, for example) and put a reverse proxy
with HTTPS in front (Caddy, nginx). The proxy must forward `Host` and `X-Forwarded-Proto`.

With `DATA_SOURCE=json` or `STORAGE_PROVIDER=local`, `DATA_DIR` must point to a folder that
survives deploys.

## Docker

```bash
docker build -t my-store --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com --build-arg ALLOW_INDEXING=1 .
docker run -d --name store -p 3000:3000 --env-file .env -v store-data:/data my-store
```

The image uses Next's standalone output, runs as an unprivileged user and keeps uploads in the
`/data` volume. Pass the other `NEXT_PUBLIC_*` values as `--build-arg` too if you use them.

## Vercel (recommended, not required)

Use the **Deploy** button in the README or import the repository. Set the environment variables
in the project settings. Notes:

- The file system is read-only and temporary: use `DATA_SOURCE=supabase` or `postgres`, and
  `STORAGE_PROVIDER=supabase` for photos.
- The in-memory rate limiter counts per instance: treat it as a first barrier
  (`lib/rate-limit.ts` says how to put a shared store behind it).
- Preview deployments are never "production": no measurement, no indexing.

## Things to set on every host

- **Secrets.** In production the server refuses to start without `ORDER_SECRET` (and
  `ADMIN_SESSION_SECRET` when there are admin users). A build does not need them.
- **The visitor's address.** Rate limits count by address, and only a trusted source can tell it.
  With one reverse proxy in front (the usual VPS set-up) the default — the last hop of
  `X-Forwarded-For` — is right. Behind a CDN or a platform, set `TRUSTED_PROXY_HEADER` to the
  header it sets (`cf-connecting-ip`, `x-real-ip`, `fly-client-ip`…). With no proxy at all, set
  it to `none`. On Vercel nothing is needed.
- **Unpaid orders.** They are cancelled after `ORDER_EXPIRY_HOURS` (48) and their stock returns.
  That runs on its own whenever the panel or the checkout is used; to also run it on a schedule
  set `CRON_SECRET` and call, from any cron:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/expire-orders`
  (on Vercel, `vercel.json` already does it once a day).

## The brain

`cerebro/dist/` is a static site (no build step). Publish it anywhere that serves files; if its
address is not the default one, rebuild it first: `BASE_URL=https://brain.example.com npm run brain`.

## After the first deploy

1. Open `/admin/settings`: it lists what is still missing.
2. Buy something end to end on a phone.
3. Only then set `ALLOW_INDEXING=1` and submit the sitemap (see `GETTING-STARTED.md`).
