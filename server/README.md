# The call backend (`server/`)

The serverless backend for **Join the call** and the **community dashboard**.
It runs on a [Cloudflare Worker](https://workers.cloudflare.com/) with a
[D1](https://developers.cloudflare.com/d1/) (SQLite) database. There is no server
to run or patch, and the free tier covers far more than launch traffic.

## What it does

- `GET /communities` — the picker list **and** the public tallies (aggregate counts only — never a name or email).
- `POST /join` — records a sign-up. If an email is given, it sends a verification link.
- `GET /verify?token=…` and `GET /forget?token=…` show prompts; their forms POST to confirm or delete a signup.
- `GET /admin/communities` and `POST /admin/approve` review and approve/reject **write-in** community names (Authorization Bearer header required).

**Honesty rules are enforced server-side:** a community's public number is its
*confirmed* voices (verified emails) only; no-email or unverified joins are
recorded but never inflate the public tally; write-in communities stay hidden
until you approve them; names and emails are private and never returned by the
public API.

Each normalized email counts once per community. Repeat joins reuse the existing
record and token. Existing duplicate records keep their deletion links, but count
only once. Email normalization trims whitespace and folds case; provider-specific
aliases are not merged.

Signup requests have an atomic per-IP quota of 25 per fixed hourly window.
An email can be used once per fixed ten-minute window across all IPs and
communities. Outgoing verification attempts have a global hourly budget of
`MAX_EMAILS_PER_HOUR` (default 100). Fixed windows can allow adjacent bursts at
a window boundary. Counters store salted hashes, expire within an hour, and are
purged on joins and by the ten-minute cron. Deleting a signup does not reset them.
`SALT` is required; missing configuration refuses signups.

## Deploy (about 10 minutes)

You'll need a free Cloudflare account and Node installed.

```bash
cd server
npm install -g wrangler        # or: npm i -D wrangler && npx wrangler ...
wrangler login

# 1) Create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create wtu_call

# 2) Create the tables and load the seed communities
wrangler d1 execute wtu_call --remote --file=./schema.sql
wrangler d1 execute wtu_call --remote --file=./seed.sql

# 3) Set secrets (you'll be prompted to paste each value)
wrangler secret put RESEND_API_KEY   # from https://resend.com (for verification emails)
wrangler secret put ADMIN_TOKEN      # any long random string — your moderation password
wrangler secret put SALT             # any random string

# 4) Edit wrangler.toml: set ALLOWED_ORIGINS / FROM_EMAIL / SITE_URL to your domain
# 5) Ship it
wrangler deploy
```

`wrangler deploy` prints the Worker URL (e.g. `https://wtu-call.<you>.workers.dev`,
or wire a custom route like `https://api.wetheusers.ai`).

## Connect the website

In `website/build_site.py`, set `API_BASE` (top of the `JS` block) to that URL,
rebuild the site, and redeploy it. Until `API_BASE` is set, the form and dashboard
run in a harmless **preview** mode (nothing is recorded; the dashboard shows the
seed communities with no counts).

## Email

Verification email goes out through [Resend](https://resend.com). Verify your
sending domain there, set `FROM_EMAIL` to an address on it, and add the
`RESEND_API_KEY` secret. Without the key, sign-ups are still recorded — they just
can't be confirmed (so they won't count). To use a different provider, replace
`sendVerifyEmail()` in `src/index.js`.

## Moderating write-in communities

When someone names a new community, it's saved as **pending** and stays off the
public dashboard until you approve it.

```bash
# list everything, pending first
curl "https://YOUR_WORKER_URL/admin/communities" \
  -H "authorization: Bearer YOUR_ADMIN_TOKEN"

# approve one
curl -X POST "https://YOUR_WORKER_URL/admin/approve" \
  -H "authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"key":"my-town","approve":true}'

# reject one (deletes it and its sign-ups)
curl -X POST "https://YOUR_WORKER_URL/admin/approve" \
  -H "authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"key":"spammy-name","approve":false}'
```

## Exporting the roll (private)

The roll is not public. To pull it for your own use:

```bash
wrangler d1 execute wtu_call --remote --command \
  "SELECT community_key, name, email, email_verified, created_at FROM signups ORDER BY created_at;"
```

## Local development

```bash
wrangler d1 execute wtu_call --local --file=./schema.sql
wrangler d1 execute wtu_call --local --file=./seed.sql
wrangler dev                  # serves on http://localhost:8787
```

Point a local build's `API_BASE` at `http://localhost:8787` and set
`ALLOWED_ORIGINS = "*"` in `[vars]` while testing.

## Updating an existing deployment

Before deploying this Worker, apply the additive migration to the existing D1
database. It adds abuse counters and a lookup index; it does not delete signups
or change their tokens. Confirm the `SALT` secret is configured, and review the
hourly email budget in `wrangler.toml`.

```bash
cd server
wrangler d1 execute wtu_call --remote --file=./migrations/0001_abuse_limits.sql
wrangler deploy
```

After deployment, confirm the cron trigger is present and public GET endpoints
still respond. Admin URLs no longer accept credentials in query strings. If an
admin secret was logged or shared in a URL, rotate it through the secret store.
Do not store a database export or credentials in this repository.

## Security checks

From the repository root, with Node.js 24.22.1 or a later supported security
release and Python 3:

```bash
node --test test/server-security.test.mjs
python tools/security-policy.py
node test/terms.test.js
```

After regenerating any static HTML page, run
`python tools/security-policy.py --write` to refresh its inline-script hashes.
GitHub Pages cannot set custom response headers here. Its meta CSP restricts
scripts and connections; framing protection requires an edge or host that can
set a `Content-Security-Policy: frame-ancestors 'none'` response header.
