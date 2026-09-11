/* Falsifiability test for W-15 ("close the residuals on Shadow").
 *
 * Serves the whole website/ tree from a local static HTTP server (Shadow
 * lives at /shadow/ under the rest of the site as of W-16) and drives the
 * real page through Playwright (headless Chromium), checking five things
 * the done-note claims, plus a sixth, filesystem-only check added by W-17:
 *
 *   1. The unfurl tags (og:title, og:description, og:image, twitter:card,
 *      twitter:title, twitter:description, twitter:image) are present and
 *      non-empty.
 *   2. The two source-list links in the <details> prose resolve with
 *      HTTP 200 from the same local static server (not a data: URL, not a
 *      404) — checked by reading their hrefs out of the rendered DOM, then
 *      fetching them directly against the server this test itself started.
 *   3. A synthetic, non-Meta archive (Google-Takeout-shaped, built by
 *      fixtures/generic/build-fixture.js) uploaded through the real file
 *      picker produces "The inferences" finding — the regression test for
 *      the scan() keyword-regex bug, where the key's closing quote sat
 *      inside the alternation and "title" (and everything but
 *      string_map_data) could never match. Also re-checks the zero-request
 *      census on this specific path, since it exercises code the other
 *      network test (which only drives the Meta fixture and the sample)
 *      does not.
 *   4. Selecting only a platform whose current-year figure is a filed loss
 *      (Reddit) produces a negative dividend, and the on-screen caption
 *      beside it reads as specified — "would have owed you" / "lost money
 *      that year" — not the old "would have paid you" text.
 *   5. The page still has no horizontal scroll at 400px after all of the
 *      above (the new links and paragraph text are the residual risk).
 *   6. (W-17) Each website/shadow/data/*.json file is byte-identical to the
 *      publish-safe transform's output of its private working-directory
 *      source — i.e. the published copy has not drifted from the underlying
 *      record in any way this repo's own sync script wouldn't produce. This
 *      is the fix for an earlier defect: a published source list that
 *      quietly contradicted the project's own corrected research. If the
 *      private working directory is absent (a fresh clone that only took
 *      website/), this check fails loudly rather than silently passing —
 *      set SHADOW_SKIP_DRIFT=1 to skip it deliberately instead.
 *   7. (W-20) None of website/shadow/data/*.json contains a task-ID shape,
 *      a crew name, or a "shift N red team" phrase, case-insensitively —
 *      filesystem-only, needs no private working directory.
 *
 * Run with:
 *   NODE_PATH="<path to a node_modules containing playwright>" \
 *     node website/shadow/test/residuals.test.js
 */
'use strict';
const http = require('http');
const https = require('https');
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
  '.jpg': 'image/jpeg',
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

function getStatus(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
}

// ---- 6. Published data must not have drifted from its private source ----
// (W-17) website/shadow/data/*.json are publish-safe copies of files kept
// in this project's private working directory (not itself under version
// control), produced by a publish-safe transform script. This asserts each
// published file is byte-identical to that transform's output of the
// current private-directory source, so the suite fails the moment the two
// diverge — the failure mode an earlier red team found live on this
// branch. If that private directory is absent (a fresh clone that only
// took website/), this check FAILS rather than silently passing, unless
// SHADOW_SKIP_DRIFT=1 is set to skip it on purpose.
function checkDataDrift() {
  const LAB_ROOT = path.join(ROOT, '..', 'lab');
  const skip = process.env.SHADOW_SKIP_DRIFT === '1';
  if (!fs.existsSync(LAB_ROOT)) {
    if (skip) {
      console.log('SKIP — private working directory not present in this checkout, and SHADOW_SKIP_DRIFT=1 is set. Not a failure.');
      return;
    }
    throw new Error(
      'FAIL — private working directory not present in this checkout, so the drift check has nothing to ' +
        'compare the published data against. This is a failure, not a skip, because it means the published ' +
        'data cannot be verified here. Set SHADOW_SKIP_DRIFT=1 if you mean to skip this check on a checkout ' +
        'that only took website/ on purpose.'
    );
  }
  let publishSafe;
  const transformPath = path.join(LAB_ROOT, 'ops', 'publish-safe-data.js');
  if (!fs.existsSync(transformPath)) {
    if (skip) {
      console.log(`SKIP — ${transformPath} not found, and SHADOW_SKIP_DRIFT=1 is set. Not a failure.`);
      return;
    }
    throw new Error(
      `FAIL — ${transformPath} not found; the drift check needs it to compare against. Set SHADOW_SKIP_DRIFT=1 ` +
        'if you mean to skip this check on purpose.'
    );
  }
  publishSafe = require(transformPath);

  const FILES = ['sources.json', 'revenue-model.json', 'export-buttons.json'];
  for (const name of FILES) {
    const labPath = path.join(LAB_ROOT, 'data', name);
    const publishedPath = path.join(SHADOW, 'data', name);
    assert.ok(fs.existsSync(labPath), `expected ${labPath} to exist`);
    assert.ok(fs.existsSync(publishedPath), `expected ${publishedPath} to exist`);
    const labData = JSON.parse(fs.readFileSync(labPath, 'utf8'));
    const expected = publishSafe.serialize(labData, name);
    const actual = fs.readFileSync(publishedPath, 'utf8');
    assert.strictEqual(
      actual,
      expected,
      `website/shadow/data/${name} has drifted from its private source — re-run the sync script`
    );
  }
  console.log(
    `PASS — website/shadow/data/{${FILES.join(',')}} are byte-identical to the publish-safe transform's ` +
      'output of their private sources; no drift.'
  );
}

// ---- 7. Published data must carry no task IDs, crew names, or process ---
//         vocabulary (W-20) --------------------------------------------
// Filesystem-only, needs no private working directory: reads the three published JSON
// files as raw text and asserts none of them contain a task-ID shape
// (L-02, W-14, A-08b, ...), a crew name, or a "shift N red team" phrase,
// case-insensitively. This is the regression test for the defect the W-20
// red team found: a publish-safe transform whose task-stamp regex was
// anchored to the start of a string, so identical tokens sitting anywhere
// else in the sentence sailed straight through to the published copy.
const WORK_LOG_TOKEN_RES = [
  { name: 'task ID', re: /\b[A-Z]-\d{2}[a-z]?\b/g },
  { name: 'crew name', re: /\b(?:ledger|wright|herald|adversary|steward|cartographer)\b/gi },
  { name: '"red team"', re: /red team/gi },
  { name: '"shift N"', re: /shift[- ]\d+/gi },
];
function checkPublishedTokenCensus() {
  const FILES = ['sources.json', 'revenue-model.json', 'export-buttons.json'];
  for (const name of FILES) {
    const publishedPath = path.join(SHADOW, 'data', name);
    const text = fs.readFileSync(publishedPath, 'utf8');
    for (const { name: tokenName, re } of WORK_LOG_TOKEN_RES) {
      const hits = text.match(re);
      assert.ok(
        !hits,
        `website/shadow/data/${name} contains a ${tokenName} (${hits && hits.join(', ')}) — the publish-safe ` +
          'transform should have stripped it'
      );
    }
  }
  console.log(
    `PASS — website/shadow/data/{${FILES.join(',')}} carry no task IDs, crew names, or "red team"/"shift N" phrases.`
  );
}

async function main() {
  checkDataDrift();
  checkPublishedTokenCensus();

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
    const page = await browser.newPage();
    const pageUrl = `${origin}/shadow/index.html`;
    await page.goto(pageUrl, { waitUntil: 'networkidle' });

    // ---- 1. Unfurl tags -------------------------------------------------
    const og = await page.evaluate(() => ({
      title: document.querySelector('meta[property="og:title"]')?.content,
      description: document.querySelector('meta[property="og:description"]')?.content,
      image: document.querySelector('meta[property="og:image"]')?.content,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
      twitterTitle: document.querySelector('meta[name="twitter:title"]')?.content,
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content,
      twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
    }));
    assert.ok(og.title && og.title.length > 0, 'expected a non-empty og:title');
    assert.ok(og.description && og.description.length > 0, 'expected a non-empty og:description');
    assert.ok(og.image && og.image.length > 0, 'expected a non-empty og:image');
    assert.strictEqual(og.twitterCard, 'summary_large_image', 'expected twitter:card = summary_large_image');
    assert.ok(og.twitterTitle && og.twitterTitle.length > 0, 'expected a non-empty twitter:title');
    assert.ok(og.twitterDescription && og.twitterDescription.length > 0, 'expected a non-empty twitter:description');
    assert.ok(og.twitterImage && og.twitterImage.length > 0, 'expected a non-empty twitter:image');
    // W-17: og:image (and twitter:image) must be absolute — the Open Graph
    // spec requires it, and some unfurlers silently drop a relative one.
    // Shadow settled its URL under W-16, so there is no longer a reason for
    // it to be the one page on the site with a relative image.
    assert.strictEqual(
      og.image,
      'https://wetheusers.ai/media/og-card.jpg',
      `expected an absolute og:image matching the rest of the site, got "${og.image}"`
    );
    assert.strictEqual(
      og.twitterImage,
      'https://wetheusers.ai/media/og-card.jpg',
      `expected an absolute twitter:image matching the rest of the site, got "${og.twitterImage}"`
    );
    // Still must resolve — checked against the local static server this
    // test itself started, using the image's path (the same file the real
    // https://wetheusers.ai/media/og-card.jpg URL will serve once deployed).
    const ogImageStatus = await getStatus(`${origin}${new URL(og.image).pathname}`);
    assert.strictEqual(ogImageStatus, 200, `expected the og:image to resolve 200, got ${ogImageStatus}`);
    console.log(
      'PASS — og:title/description/image and twitter:card/title/description/image present; ' +
        'og:image is absolute and resolves locally.'
    );

    // ---- 2. Source-list links resolve ------------------------------------
    const detailsLinks = await page.evaluate(() => {
      const details = [...document.querySelectorAll('details')].find((d) =>
        d.textContent.includes('the source list is published with this page')
      );
      if (!details) return null;
      return [...details.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    });
    assert.ok(detailsLinks, 'expected to find the <details> paragraph claiming the source list is published');
    assert.strictEqual(detailsLinks.length, 2, `expected exactly two source-list links, got ${detailsLinks.length}`);
    for (const href of detailsLinks) {
      assert.ok(!href.startsWith('data:'), `expected a real relative href, not a data: URL — got "${href}"`);
      const status = await getStatus(new URL(href, pageUrl).href);
      assert.strictEqual(status, 200, `expected ${href} to resolve 200 from the local server, got ${status}`);
    }
    console.log(`PASS — both source-list links (${detailsLinks.join(', ')}) resolve 200 from the local static server.`);

    // ---- 3. scan() regex fix: a non-Meta "title" key must be detected ---
    const fixtureZip = path.join(SHADOW, 'fixtures', 'generic', 'takeout-export.zip');
    assert.ok(
      fs.existsSync(fixtureZip),
      'fixture missing — run: node website/shadow/fixtures/generic/build-fixture.js'
    );

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

    const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pick')]);
    await fileChooser.setFiles(fixtureZip);
    await page.waitForFunction(() => document.querySelector('#finds').style.display === 'block', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const inferences = await page.evaluate(() => {
      const finds = [...document.querySelectorAll('.find')];
      const f = finds.find((el) => el.querySelector('.v').textContent === 'The inferences');
      if (!f) return null;
      return { tags: [...f.querySelectorAll('.tag')].map((t) => t.textContent) };
    });
    assert.ok(
      inferences,
      '"The inferences" finding did not appear for a non-Meta archive with a "title" key — the scan() regex regression is not fixed'
    );
    assert.ok(inferences.tags.length > 0, 'expected at least one word tag under "The inferences"');
    assert.ok(
      inferences.tags.includes('mortgage') || inferences.tags.includes('refinance'),
      `expected a word from the fixture's titles among the top tags, got: ${inferences.tags.join(', ')}`
    );
    console.log(`PASS — "The inferences" fired on a non-Meta archive; top tags: ${inferences.tags.slice(0, 6).join(', ')}`);

    assert.strictEqual(
      otherOriginRequests.length,
      0,
      `expected zero requests to any origin other than the page's own on the generic upload path; got: ${otherOriginRequests.join(', ')}`
    );
    assert.strictEqual(consoleErrors.length, 0, `expected zero console/page errors; got: ${consoleErrors.join(' | ')}`);
    console.log('PASS — zero non-origin requests and zero console errors on the generic (non-Meta) upload path.');

    // ---- 4. Negative-dividend caption ------------------------------------
    // Default state has Meta and Google on. Turn those off, turn Reddit on
    // (a filed net loss every year on record) to force the total dividend
    // negative, then read the caption text next to it.
    await page.evaluate(() => {
      document.querySelectorAll('.plat.on').forEach((el) => el.click());
      const reddit = document.querySelector('.plat[data-k="reddit"]');
      if (!reddit.classList.contains('on')) reddit.click();
    });
    const capState = await page.evaluate(() => ({
      dividend: document.getElementById('dividend').textContent,
      isNeg: document.getElementById('dividend').classList.contains('neg'),
      caption: document.getElementById('dividendCap').textContent,
    }));
    console.log(`Reddit-only dividend: ${capState.dividend} (neg=${capState.isNeg})`);
    assert.ok(capState.isNeg, `expected a negative dividend for Reddit-only, got ${capState.dividend}`);
    assert.ok(
      !/would have paid you/i.test(capState.caption),
      `negative-dividend caption must not say "would have paid you" — got: "${capState.caption}"`
    );
    assert.ok(
      /would have owed you/i.test(capState.caption) && /lost money that year/i.test(capState.caption),
      `expected the negative-dividend caption to read as specified — got: "${capState.caption}"`
    );
    console.log(`PASS — negative-dividend caption reads: "${capState.caption}"`);

    // ---- 5. Still no horizontal scroll at 400px --------------------------
    await page.setViewportSize({ width: 400, height: 800 });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`400px viewport: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`);
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `expected no horizontal scroll at 400px width; scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    );
    console.log('PASS — no horizontal scroll at 400px width after all W-15 changes.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
