# The call backend (`server/`)

The serverless backend for **Join the call** and the **community dashboard**.
It runs on a [Cloudflare Worker](https://workers.cloudflare.com/) with a
[D1](https://developers.cloudflare.com/d1/) (SQLite) database. There is no server
to run or patch, and the free tier covers far more than launch traffic.

## What it does

- `GET /communities` — the picker list **and** the public tallies (aggregate counts only — never a name or email).
- `POST /join` — records a sign-up. If an email is given, it sends a verification link.
- `GET /verify?token=…` — confirms an email and shows a small "you're counted" page.
- `GET /admin/communities?token=…` and `POST /admin/approve` — review and approve/reject **write-in** community names (guarded by `ADMIN_TOKEN`).

**Honesty rules are enforced server-side:** a community's public number is its
*confirmed* voices (verified emails) only; no-email or unverified joins are
recorded but never inflate the public tally; write-in communities stay hidden
until you approve them; names and emails are private and never returned by the
public API.

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
curl "https://YOUR_WORKER_URL/admin/communities?token=YOUR_ADMIN_TOKEN"

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
