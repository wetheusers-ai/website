/**
 * We the Users — "Join the call" backend
 * Cloudflare Worker + D1 (SQLite). No server to run.
 *
 * Public endpoints (CORS-guarded):
 *   GET  /communities         -> picker list + public tallies (aggregate counts only)
 *   POST /join                -> record a sign-up; emails get a verification link
 *   GET  /verify?token=...    -> confirm an email (returns a small HTML page)
 *
 * Admin endpoints (require ADMIN_TOKEN):
 *   GET  /admin/communities?token=...      -> list communities incl. pending write-ins
 *   POST /admin/approve  {key, approve}    -> approve or reject a write-in community
 *
 * Honesty rules baked in:
 *   - A community's PUBLIC number is its CONFIRMED voices (verified emails) only.
 *   - A community is publicly LISTED only once it reaches MIN_PUBLIC_TALLY confirmed
 *     voices (default 50). The picker always offers every approved community.
 *   - No-email / unverified joins are recorded but never inflate the public tally.
 *   - Write-in communities start PENDING and never appear publicly until approved.
 *   - Names and emails are private; /communities never returns them.
 */

const SISO = (d) => new Date(d).toISOString();

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(origin),
    },
  });
}
function allowedOrigin(req, env) {
  const o = req.headers.get("Origin") || "";
  const allow = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  if (allow.includes("*")) return "*";
  return allow.includes(o) ? o : (allow[0] || "*");
}
function slugify(s) {
  return s.toLowerCase().trim()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
function rand(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendVerifyEmail(env, email, link) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "no_key" };
  const from = env.FROM_EMAIL || "We the Users <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Confirm your place in the call",
        html:
          `<div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;color:#13203B;line-height:1.6">
             <p style="font-size:19px;margin:0 0 14px">We believe there is a better way.</p>
             <p>Thank you for joining the call for an internet owned by the people who use it. Confirm your email so your voice is counted toward your community, and so we can keep you posted as the work moves forward.</p>
             <p style="margin:28px 0"><a href="${link}" style="background:#B08D3A;color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Confirm my place</a></p>
             <p style="font-size:13px;color:#667">If you didn't ask to join, just ignore this email — nothing will be recorded.</p>
           </div>`,
      }),
    });
    return { sent: r.ok, reason: r.ok ? "ok" : `resend_${r.status}` };
  } catch (e) {
    return { sent: false, reason: "fetch_error" };
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    try {
      if (url.pathname === "/communities" && req.method === "GET") return getCommunities(env, origin);
      if (url.pathname === "/join" && req.method === "POST") return join(req, env, origin);
      if (url.pathname === "/verify" && req.method === "GET") return verify(url, env);
      if (url.pathname === "/admin/communities" && req.method === "GET") return adminList(req, url, env, origin);
      if (url.pathname === "/admin/approve" && req.method === "POST") return adminApprove(req, env, origin);
      if (url.pathname === "/") return json({ ok: true, service: "wtu-call" }, 200, origin);
      return json({ ok: false, error: "not_found" }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: "server_error", detail: String((e && e.message) || e) }, 500, origin);
    }
  },
};

async function getCommunities(env, origin) {
  // A community takes the public ledger only once it reaches this many CONFIRMED
  // voices. The picker list below is never filtered — every approved community
  // stays choosable, or nothing could ever reach the threshold.
  const minListed = Math.max(0, Number(env.MIN_PUBLIC_TALLY ?? 50) || 0);
  const rows = await env.DB.prepare(
    `SELECT c.key AS key, c.name AS name, c.category AS category,
            COALESCE(SUM(CASE WHEN s.email_verified=1 THEN 1 ELSE 0 END),0) AS confirmed,
            COUNT(s.id) AS total
       FROM communities c
       LEFT JOIN signups s ON s.community_key = c.key
      WHERE c.approved = 1
      GROUP BY c.key, c.name, c.category
      ORDER BY confirmed DESC, total DESC, c.name ASC`
  ).all();
  const all = (rows.results || []).map((r) => ({
    key: r.key, name: r.name, category: r.category || null,
    confirmed: Number(r.confirmed) || 0,
    total: Number(r.total) || 0,
  }));
  // Movement-wide totals stay unfiltered and honest.
  const totals = all.reduce(
    (a, t) => ({ confirmed: a.confirmed + t.confirmed, total: a.total + t.total, communities: a.communities + 1 }),
    { confirmed: 0, total: 0, communities: 0 }
  );
  const tallies = all.filter((t) => t.confirmed >= minListed);
  totals.listed = tallies.length;
  return json({
    ok: true,
    communities: all.map((t) => ({ key: t.key, name: t.name, category: t.category })),
    tallies, totals,
  }, 200, origin);
}

async function join(req, env, origin) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, origin); }

  let community = String(body.community || "").trim().slice(0, 80);
  const name = (String(body.name || "").trim().slice(0, 80)) || null;
  const email = (String(body.email || "").trim().slice(0, 200)) || null;
  if (!community) return json({ ok: false, error: "community_required" }, 400, origin);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "bad_email" }, 400, origin);
  const key = slugify(community);
  if (!key) return json({ ok: false, error: "bad_community" }, 400, origin);

  // light per-IP throttle (hashed; no raw IP stored)
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  const ipHash = await sha256(ip + "|" + (env.SALT || "wtu"));
  const hourAgo = SISO(Date.now() - 3600_000);
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM signups WHERE ip_hash=? AND created_at>?`)
    .bind(ipHash, hourAgo).first();
  if (recent && Number(recent.n) >= 25) return json({ ok: false, error: "rate_limited" }, 429, origin);

  const now = SISO(Date.now());
  // Resolve by derived key OR exact display name: the picker submits names
  // (e.g. "The Linux community"), whose slug rarely matches curated seed keys
  // (e.g. "linux-community"). Without the name match, picker signups silently
  // create pending duplicates and vanish from the public tallies.
  const existing = await env.DB.prepare(
    `SELECT key, approved FROM communities WHERE key=?1 OR lower(name)=lower(?2) LIMIT 1`
  ).bind(key, community).first();
  const useKey = existing ? existing.key : key;
  let communityPending;
  if (!existing) {
    await env.DB.prepare(`INSERT INTO communities (key, name, approved, seeded, created_at) VALUES (?,?,0,0,?)`)
      .bind(key, community, now).run();
    communityPending = true;
  } else {
    communityPending = !existing.approved;
  }

  const id = rand(16);
  const vtoken = email ? rand(24) : null;
  await env.DB.prepare(
    `INSERT INTO signups (id, community_key, name, email, email_verified, verify_token, created_at, ip_hash)
     VALUES (?,?,?,?,0,?,?,?)`
  ).bind(id, useKey, name, email, vtoken, now, ipHash).run();

  let emailStatus = "none";
  if (email && vtoken) {
    const base = env.PUBLIC_BASE || new URL(req.url).origin;
    const res = await sendVerifyEmail(env, email, `${base}/verify?token=${vtoken}`);
    emailStatus = res.sent ? "sent" : "unsent:" + res.reason;
  }
  return json({
    ok: true,
    status: email ? "pending_verification" : "joined",
    emailStatus, communityPending,
    community: { key: useKey, name: community },
  }, 200, origin);
}

function verifyPage(title, msg, env, ok) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <body style="margin:0;background:#F1ECDD">
     <div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;padding:16vh 24px;color:#13203B;text-align:center">
       <div style="width:22px;height:22px;background:${ok ? "#B08D3A" : "#9AA6BC"};transform:rotate(45deg);margin:0 auto 28px"></div>
       <h1 style="font-weight:600;font-size:30px;margin:0 0 14px">${title}</h1>
       <p style="font-size:18px;line-height:1.65;color:#33405c;margin:0">${msg}</p>
       ${env.SITE_URL ? `<p style="margin-top:32px"><a href="${env.SITE_URL}" style="color:#B08D3A;font-family:ui-monospace,monospace;font-size:14px;text-decoration:none">Return to We the Users &rarr;</a></p>` : ""}
     </div></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}
async function verify(url, env) {
  const t = url.searchParams.get("token") || "";
  if (!t) return verifyPage("Invalid link", "This confirmation link is missing its token.", env, false);
  const row = await env.DB.prepare(`SELECT id FROM signups WHERE verify_token=?`).bind(t).first();
  if (!row) return verifyPage("Already confirmed, or expired", "We couldn't find a pending confirmation for this link — it may already be confirmed.", env, false);
  await env.DB.prepare(`UPDATE signups SET email_verified=1, verify_token=NULL, verified_at=? WHERE id=?`)
    .bind(SISO(Date.now()), row.id).run();
  return verifyPage("You're counted.", "Thank you for joining the call. Your email is confirmed, your community now reflects your voice, and we'll keep you posted as the work moves forward.", env, true);
}

function adminAuthed(req, url, env) {
  const auth = req.headers.get("Authorization") || "";
  const t = auth.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  return Boolean(env.ADMIN_TOKEN) && t === env.ADMIN_TOKEN;
}
async function adminList(req, url, env, origin) {
  if (!adminAuthed(req, url, env)) return json({ ok: false, error: "unauthorized" }, 401, origin);
  const rows = await env.DB.prepare(
    `SELECT c.key, c.name, c.category, c.approved, c.seeded, c.created_at,
            COUNT(s.id) AS signups,
            COALESCE(SUM(CASE WHEN s.email_verified=1 THEN 1 ELSE 0 END),0) AS confirmed
       FROM communities c LEFT JOIN signups s ON s.community_key=c.key
      GROUP BY c.key ORDER BY c.approved ASC, signups DESC, c.name ASC`
  ).all();
  return json({ ok: true, communities: rows.results || [] }, 200, origin);
}
async function adminApprove(req, env, origin) {
  const url = new URL(req.url);
  if (!adminAuthed(req, url, env)) return json({ ok: false, error: "unauthorized" }, 401, origin);
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, origin); }
  const key = String(body.key || "");
  const approve = body.approve !== false;
  const category = (typeof body.category === "string" && body.category.trim()) ? body.category.trim() : null;
  if (!key) return json({ ok: false, error: "key_required" }, 400, origin);
  if (approve) {
    await env.DB.prepare(`UPDATE communities SET approved=1, category=COALESCE(?, category) WHERE key=?`).bind(category, key).run();
  } else {
    await env.DB.prepare(`DELETE FROM signups WHERE community_key=?`).bind(key).run();
    await env.DB.prepare(`DELETE FROM communities WHERE key=?`).bind(key).run();
  }
  return json({ ok: true, key, approved: approve }, 200, origin);
}
