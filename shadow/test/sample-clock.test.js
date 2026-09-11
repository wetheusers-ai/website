/* Falsifiability test for FATAL 3 — the sample generator must build its
 * events from local midnight, not from the current moment, so the peak
 * hour it reports is stable regardless of when the visitor loads the page.
 *
 * Serves the whole website/ tree from a local static HTTP server (Shadow
 * lives at /shadow/ under the rest of the site as of W-16), drives the real
 * page through Playwright (headless Chromium) twice — once with the
 * browser's clock frozen at 03:05 local time, once at 15:05 the same
 * calendar day — clicks "Try it with a sample" both times, and asserts the
 * rendered "The rhythm" finding (peak hour, quiet-hours text, and hour
 * histogram) is byte-for-byte identical. Math.random() is also seeded
 * identically for both runs, so this is an exact-equality check, not a
 * statistical one.
 *
 * Run with:
 *   NODE_PATH="<path to a node_modules containing playwright>" \
 *     node website/shadow/test/sample-clock.test.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Two levels up from website/shadow/test/ is website/ itself.
const ROOT = path.join(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
  '.json': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const full = path.join(ROOT, p);
      fs.readFile(full, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + p);
          return;
        }
        const ext = path.extname(full);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Freezes the page's Date to `fixedMs` for `new Date()`/`Date.now()` (used
// by the sample generator to find "today"), while leaving explicit
// `new Date(...)` constructions (used elsewhere, e.g. formatting a real
// export's span) working normally. Also replaces Math.random() with a
// small seeded PRNG (mulberry32), reset to the same seed on every page, so
// two runs with different clocks but the fix applied produce an identical
// event set — an exact-equality check instead of a statistical one.
async function installFakeClock(page, fixedMs) {
  await page.addInitScript((ms) => {
    const OrigDate = Date;
    class FakeDate extends OrigDate {
      constructor(...args) {
        if (args.length === 0) return new OrigDate(ms);
        return new OrigDate(...args);
      }
      static now() {
        return ms;
      }
    }
    window.Date = FakeDate;

    let seed = 42;
    Math.random = function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, fixedMs);
}

async function runSampleAt(browser, origin, fixedMs) {
  const page = await browser.newPage();
  await installFakeClock(page, fixedMs);
  await page.goto(`${origin}/shadow/index.html`, { waitUntil: 'networkidle' });
  await page.click('#demo');
  await page.waitForFunction(() => document.querySelector('#finds').style.display === 'block');

  const rhythm = await page.evaluate(() => {
    const finds = [...document.querySelectorAll('.find')];
    const f = finds.find((el) => el.querySelector('.v').textContent === 'The rhythm');
    if (!f) return null;
    return {
      h: f.querySelector('.h').textContent,
      p: f.querySelector('p').textContent,
      spark: [...f.querySelectorAll('.spark i')].map((i) => i.style.height),
    };
  });

  await page.close();
  return rhythm;
}

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error(
      'FAIL — could not load the "playwright" package. This test needs it resolvable ' +
        '(e.g. NODE_PATH pointed at a cached install); see the header comment in this file.'
    );
    process.exit(1);
  }

  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (e) {
    browser = await playwright.chromium.launch({ channel: 'chrome' });
  }

  try {
    // Same calendar day, two very different times of day.
    const t1 = new Date(2026, 5, 15, 3, 5, 0).getTime(); // 03:05
    const t2 = new Date(2026, 5, 15, 15, 5, 0).getTime(); // 15:05

    const r1 = await runSampleAt(browser, origin, t1);
    const r2 = await runSampleAt(browser, origin, t2);

    assert.ok(r1, 'expected a "The rhythm" finding when the sample is loaded at 03:05');
    assert.ok(r2, 'expected a "The rhythm" finding when the sample is loaded at 15:05');

    console.log(`03:05 -> ${r1.h}`);
    console.log(`15:05 -> ${r2.h}`);

    assert.strictEqual(
      r1.h,
      r2.h,
      `expected the same peak-hour headline regardless of wall-clock time; got "${r1.h}" at 03:05 vs "${r2.h}" at 15:05`
    );
    assert.strictEqual(
      r1.p,
      r2.p,
      'expected the same quiet-hours sentence regardless of wall-clock time'
    );
    assert.deepStrictEqual(
      r1.spark,
      r2.spark,
      'expected an identical 24-hour histogram regardless of wall-clock time'
    );

    console.log('PASS — sample generator produces one stable hour histogram at two different wall-clock times.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
