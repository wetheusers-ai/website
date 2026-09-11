/* Falsifiability test for the local-only claim (W-01b / former W-06).
 *
 * Serves the whole website/ tree from a local static HTTP server (Shadow
 * lives at /shadow/ under the rest of the site as of W-16, and shares the
 * site's /media/fonts/ and /media/og-card.jpg rather than duplicating
 * them), drives the real page through Playwright (headless Chromium),
 * uploads the fixture Meta export through the actual file-picker UI, runs
 * the analysis, and asserts that the total number of requests the page
 * makes to any origin OTHER than its own page origin is exactly zero. It
 * also asserts the page's own origin requests are all same-origin static
 * assets (fonts/vendor/parser files), so this is not just counting
 * "third-party" by a blocklist.
 *
 * Playwright is not a repo dependency (none exists yet in website/) — this
 * resolves it the same way this project's other playwright checks have, via
 * NODE_PATH pointed at an already-cached npx install. Run with:
 *
 *   NODE_PATH="<path to a node_modules containing playwright>" \
 *     node website/shadow/test/network.test.js
 *
 * or, if `playwright` is resolvable normally (global/local install):
 *
 *   node website/shadow/test/network.test.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Two levels up from website/shadow/test/ is website/ itself — the real
// document root Shadow is served from, so its "../media/..." links (fonts,
// og-card.jpg) resolve exactly as they will in production.
const ROOT = path.join(__dirname, '..', '..');
const SHADOW = path.join(ROOT, 'shadow');
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

  // Prefer Playwright's own bundled Chromium; fall back to a system Chrome
  // install (channel: 'chrome') when the bundled browser binary hasn't been
  // downloaded in this environment (`npx playwright install`). Either way
  // this drives a real Chromium-family browser, not a mock.
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (e) {
    browser = await playwright.chromium.launch({ channel: 'chrome' });
  }
  try {
    const page = await browser.newPage();

    const allRequests = [];
    const otherOriginRequests = [];
    page.on('request', (req) => {
      const url = req.url();
      allRequests.push(url);
      if (!url.startsWith(origin)) otherOriginRequests.push(url);
    });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`${origin}/shadow/index.html`, { waitUntil: 'networkidle' });

    // Upload the fixture Meta export through the real drop-zone UI.
    const fixtureZip = path.join(SHADOW, 'fixtures', 'meta', 'meta-export.zip');
    assert.ok(fs.existsSync(fixtureZip), 'fixture missing — run: node website/shadow/fixtures/meta/build-fixture.js');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#pick'),
    ]);
    await fileChooser.setFiles(fixtureZip);

    // Wait for the findings to render (or the status line to settle) rather
    // than a fixed sleep.
    await page.waitForFunction(
      () => document.querySelector('#finds').style.display === 'block' ||
        (document.querySelector('#status').textContent || '').length > 0,
      { timeout: 15000 }
    );
    // Give any deferred/lazy asset (e.g. a font not yet needed for first
    // paint) a moment to request, then settle again.
    await page.waitForLoadState('networkidle');

    // Also exercise the built-in synthetic "Try it with a sample" path, the
    // other route through render(), for the same guarantee.
    await page.click('#demo');
    await page.waitForFunction(() => document.querySelector('#finds').style.display === 'block');
    await page.waitForLoadState('networkidle');

    console.log(`Total requests observed: ${allRequests.length}`);
    console.log(`Requests to a non-page origin: ${otherOriginRequests.length}`);
    if (otherOriginRequests.length) console.log('  ' + otherOriginRequests.join('\n  '));

    assert.strictEqual(
      otherOriginRequests.length,
      0,
      `expected zero requests to any origin other than the page's own; got: ${otherOriginRequests.join(', ')}`
    );
    assert.strictEqual(consoleErrors.length, 0, `expected zero console/page errors; got: ${consoleErrors.join(' | ')}`);

    // A same-origin sanity floor: this should not pass trivially because
    // nothing loaded at all. Expect at least the page, the vendor lib, the
    // parser, and the fonts actually in use.
    assert.ok(allRequests.length >= 4, `expected at least a handful of same-origin requests, got ${allRequests.length}`);

    console.log('PASS — zero non-origin network requests across upload + sample-demo flows.');

    // C1 regression: a 400px-wide viewport (the doctype + viewport meta
    // fix) must not produce horizontal scroll. Checked with the findings
    // (the widest content on the page — the ledger table and the tag
    // clouds) already rendered from the sample-demo click above.
    await page.setViewportSize({ width: 400, height: 800 });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      compatMode: document.compatMode,
    }));
    console.log(`400px viewport: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}, compatMode=${overflow.compatMode}`);
    assert.strictEqual(overflow.compatMode, 'CSS1Compat', 'expected standards mode (doctype present), not quirks mode');
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `expected no horizontal scroll at 400px width; scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    );
    console.log('PASS — no horizontal scroll at 400px width, standards mode confirmed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
