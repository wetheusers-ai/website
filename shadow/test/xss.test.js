/* Falsifiability test: a crafted Google Takeout archive must not run
 * script in the shadow tool.
 *
 * Serves the whole website/ tree from a local static HTTP server (Shadow
 * lives at /shadow/ under the rest of the site), drives the real page
 * through Playwright (headless Chromium, the system channel), uploads the
 * poisoned fixture at fixtures/google-poison/google-poison-export.zip
 * (rebuild with `node fixtures/google-poison/build-fixture.js` if
 * fixture-data.js changes) through the actual file-picker UI — the same
 * path a stranger would use — and asserts:
 *
 *   1. The payload string (`<img src=x onerror="window.__pwned=1">`)
 *      appears literally, as text, in the rendered "products" headline —
 *      i.e. the page did not drop or silently strip it, it neutralized it.
 *   2. `window.__pwned` is undefined after render — the onerror handler
 *      never ran.
 *   3. No `<img>`, `<svg>`, or `<script>` node exists anywhere under
 *      `#finds .find` — no markup from the archive was parsed as markup.
 *   4. `location.href` is unchanged after render — the navigation-exfil
 *      path a page could still be vulnerable to even after it escapes
 *      markup, if a handler were still able to fire.
 *   5. Zero requests left the page's own origin, same census the other
 *      tests run, on this specific upload path.
 *
 * Run with:
 *   NODE_PATH="<path to a node_modules containing playwright>" \
 *     node website/shadow/test/xss.test.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

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

  const fixtureZip = path.join(SHADOW, 'fixtures', 'google-poison', 'google-poison-export.zip');
  assert.ok(
    fs.existsSync(fixtureZip),
    'fixture missing — run: node website/shadow/fixtures/google-poison/build-fixture.js'
  );
  const D = require(path.join(SHADOW, 'fixtures', 'google-poison', 'fixture-data.js'));

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
    const page = await browser.newPage();

    const allRequests = [];
    const otherOriginRequests = [];
    page.on('request', (req) => {
      const url = req.url();
      allRequests.push(url);
      if (!url.startsWith(origin)) otherOriginRequests.push(url);
    });

    const startHref = `${origin}/shadow/index.html`;
    await page.goto(startHref, { waitUntil: 'networkidle' });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#pick'),
    ]);
    await fileChooser.setFiles(fixtureZip);

    await page.waitForFunction(
      () => document.querySelector('#finds').style.display === 'block' ||
        (document.querySelector('#status').textContent || '').length > 0,
      { timeout: 15000 }
    );
    await page.waitForLoadState('networkidle');

    const statusText = await page.locator('#status').textContent();
    console.log('status:', statusText);

    // 1. The payload string must appear literally, as text, in the
    // rendered products headline — proving it was read and shown, not
    // silently dropped, while never being parsed as markup.
    const findsHTML = await page.locator('#finds').innerHTML();
    const findsText = await page.locator('#finds').innerText();
    assert.ok(
      findsText.includes(D.PAYLOAD_FOLDER),
      `expected the payload string to appear literally as text in #finds; got: ${findsText.slice(0, 400)}`
    );
    // And the raw HTML must carry it entity-encoded, not as a live tag —
    // the direct evidence the sink escaped it rather than passing it
    // through.
    assert.ok(
      findsHTML.includes('&lt;img') && !findsHTML.includes('<img'),
      'expected the payload to appear HTML-escaped (&lt;img...) in the rendered markup, and no literal <img to be present'
    );

    // 2. onerror must never have fired.
    const pwned = await page.evaluate(() => window.__pwned);
    assert.strictEqual(pwned, undefined, `expected window.__pwned to stay undefined; got ${pwned}`);

    // 3. No img/svg/script node anywhere under the findings.
    const hostileNodeCount = await page.locator('#finds .find img, #finds .find svg, #finds .find script').count();
    assert.strictEqual(hostileNodeCount, 0, `expected zero img/svg/script nodes under .find; got ${hostileNodeCount}`);

    // 4. location.href must be unchanged — the navigation-exfil path is
    // the thing the CSP alone cannot stop.
    const hrefAfter = await page.evaluate(() => location.href);
    assert.strictEqual(hrefAfter, startHref, `expected location.href unchanged; got ${hrefAfter}`);

    // 5. Zero off-origin requests on this specific upload path.
    assert.strictEqual(
      otherOriginRequests.length,
      0,
      `expected zero requests to any origin other than the page's own; got: ${otherOriginRequests.join(', ')}`
    );

    console.log('PASS — poisoned Takeout folder name renders as literal text, window.__pwned stays undefined, no img/svg/script node under .find, location.href unchanged, zero off-origin requests.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
