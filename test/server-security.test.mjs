import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server/src/index.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const schema = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
function setup(t, vars = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  db.prepare('INSERT INTO communities VALUES (?,?,?,?,?,?)').run('test', 'Test', null, 1, 1, new Date().toISOString());
  const env = {
    ALLOWED_ORIGINS: 'https://wetheusers.ai', ADMIN_TOKEN: 'local-admin', SALT: 'local-test-salt', MIN_PUBLIC_TALLY: '0',
    DB: { prepare(sql) {
      const stmt = db.prepare(sql); let args = [];
      return { bind(...a) { args = a; return this; }, async first() { return stmt.get(...args) || null; },
        async all() { return { results: stmt.all(...args) }; }, async run() { return stmt.run(...args); } };
    } }, ...vars,
  };
  const call = (path, opts = {}) => worker.fetch(new Request('https://api.example.invalid' + path, opts), env);
  const join = (body = { community: 'Test' }, ip = '192.0.2.1', origin = 'https://wetheusers.ai') => call('/join', {
    method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  const act = (path, token) => call(path, { method: 'POST', headers: { origin: 'https://api.example.invalid' }, body: new URLSearchParams({ token }) });
  return { db, env, call, join, act };
}

test('deletion cannot restore an exhausted signup quota', async t => {
  const s = setup(t);
  assert.equal((await s.join({ community: 'Test', email: 'owner@example.invalid' })).status, 200);
  const { verify_token: token } = s.db.prepare('SELECT verify_token FROM signups').get();
  for (let n = 0; n < 24; n++) assert.equal((await s.join()).status, 200);
  assert.equal((await s.join()).status, 429);
  assert.equal((await s.act('/forget', token)).status, 200);
  assert.equal((await s.join()).status, 429);
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups WHERE verify_token=?').get(token).n, 0);
});

test('concurrent joins cannot overrun the atomic IP quota', async t => {
  const s = setup(t);
  const responses = await Promise.all(Array.from({ length: 40 }, () => s.join()));
  assert.equal(responses.filter(r => r.status === 200).length, 25);
  assert.equal(responses.filter(r => r.status === 429).length, 15);
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups').get().n, 25);
});

test('mailbox cooldown spans IPs and deletion; repeat joins preserve the original token and row', async t => {
  let now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const s = setup(t);
  const body = { community: 'Test', name: 'Owner', email: ' User@Example.Invalid ' };
  assert.equal((await s.join(body)).status, 200);
  const original = s.db.prepare('SELECT * FROM signups').get();
  assert.equal((await s.join(body, '192.0.2.2')).status, 429);
  now += 600001;
  assert.equal((await s.join({ ...body, name: 'Changed' }, '192.0.2.2')).status, 200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups').get().n, 1);
  assert.deepEqual(s.db.prepare('SELECT * FROM signups').get(), original);
  assert.equal((await s.act('/verify', original.verify_token)).status, 200);
  assert.equal((await s.act('/forget', original.verify_token)).status, 200);
  assert.equal((await s.join(body, '192.0.2.3')).status, 429);
});

test('legacy duplicates count once, preserve links, and cannot push a community over its threshold', async t => {
  const s = setup(t, { MIN_PUBLIC_TALLY: '50' });
  const insert = s.db.prepare('INSERT INTO signups (id,community_key,email,email_verified,verify_token,created_at) VALUES (?,?,?,?,?,?)');
  for (let n = 0; n < 51; n++) insert.run(String(n), 'test', n % 2 ? ' User@Example.Invalid ' : 'user@example.invalid', 1, n.toString(16).padStart(48, '0'), '2026-01-01');
  const data = await (await s.call('/communities')).json();
  assert.equal(data.totals.confirmed, 1); assert.deepEqual(data.tallies, []);
  const admin = await (await s.call('/admin/communities', { headers: { authorization: 'Bearer local-admin' } })).json();
  assert.equal(admin.communities[0].confirmed, 1);
  assert.equal((await s.act('/forget', '0'.repeat(48))).status, 200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups').get().n, 50);
});

test('global email budget caps concurrent recipients across distinct IPs', async t => {
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response('{}'); });
  const s = setup(t, { MAX_EMAILS_PER_HOUR: '2', RESEND_API_KEY: 'synthetic-local-key' });
  const responses = await Promise.all(Array.from({ length: 5 }, (_, n) => s.join({ community: 'Test', email: `user${n}@example.invalid` }, `192.0.2.${n + 1}`)));
  assert.equal(responses.filter(r => r.status === 200).length, 2);
  assert.equal(responses.filter(r => r.status === 429).length, 3);
  assert.equal(sends, 2);
  assert.equal(s.db.prepare("SELECT hits FROM abuse_limits WHERE bucket LIKE 'mail-global:%'").get().hits, 2);
});

test('reject foreign browser writes but allow own token forms and originless API clients', async t => {
  const s = setup(t);
  assert.equal((await s.join({}, '192.0.2.1', 'https://evil.example.invalid')).status, 403);
  const preflight = await s.call('/join', { method: 'OPTIONS', headers: { origin: 'https://evil.example.invalid' } });
  assert.equal(preflight.status, 403); assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.equal((await s.join({ community: 'Test' }, '192.0.2.1', '')).status, 200);
  assert.equal((await s.act('/verify', 'invalid')).status, 400);
});

test('admin authentication accepts only a Bearer header', async t => {
  const s = setup(t);
  assert.equal((await s.call('/admin/communities?token=local-admin')).status, 401);
  assert.equal((await s.call('/admin/communities', { headers: { authorization: 'local-admin' } })).status, 401);
  assert.equal((await s.call('/admin/communities', { headers: { authorization: 'Bearer local-admin' } })).status, 200);
});

test('token prompts are inert, unframeable and do not leak referrers', async t => {
  const s = setup(t);
  for (const path of ['/verify', '/forget']) {
    const response = await s.call(path + '?token=' + 'a'.repeat(48));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await response.text(), /method="POST"/);
  }
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups').get().n, 0);
});

test('bounded JSON, missing salt and asynchronous database failures fail safely', async t => {
  const s = setup(t);
  for (const body of ['null', '[]', '{']) {
    assert.equal((await s.call('/join', { method: 'POST', body })).status, 400);
  }
  assert.equal((await s.join({ community: 'Test', name: 'x'.repeat(9000) })).status, 413);
  delete s.env.SALT; assert.equal((await s.join()).status, 503);
  s.env.DB.prepare = () => ({ async all() { throw new Error('private database detail'); } });
  const response = await s.call('/communities');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: 'server_error' });
});

test('expired abuse buckets are purged; active hashes contain no raw identifiers', async t => {
  let now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const s = setup(t);
  assert.equal((await s.join({ community: 'Test', email: 'owner@example.invalid' })).status, 200);
  const buckets = s.db.prepare('SELECT bucket FROM abuse_limits').all();
  assert.ok(buckets.every(r => !r.bucket.includes('owner') && !r.bucket.includes('192.0.2.1')));
  const signupHash = s.db.prepare('SELECT ip_hash FROM signups').get().ip_hash;
  assert.ok(buckets.every(r => !r.bucket.includes(signupHash)));
  now += 3600001;
  await worker.scheduled({}, s.env);
  assert.equal(s.db.prepare('SELECT count(*) n FROM abuse_limits').get().n, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM signups').get().n, 1);
});

test('additive migration can be reapplied without deleting signup data', t => {
  const s = setup(t);
  s.db.exec('DROP TABLE abuse_limits; DROP INDEX idx_signups_mailbox_community;');
  s.db.prepare('INSERT INTO signups (id, community_key, email, verify_token, created_at) VALUES (?,?,?,?,?)').run('legacy', 'test', 'old@example.invalid', 'b'.repeat(48), '2026-01-01');
  const migration = fs.readFileSync(new URL('../server/migrations/0001_abuse_limits.sql', import.meta.url), 'utf8');
  s.db.exec(migration); s.db.exec(migration);
  assert.equal(s.db.prepare('SELECT verify_token FROM signups WHERE id=?').get('legacy').verify_token, 'b'.repeat(48));
  assert.equal(s.db.prepare('SELECT count(*) n FROM abuse_limits').get().n, 0);
});
