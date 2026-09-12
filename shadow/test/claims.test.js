/* Falsifiability test for the on-screen sentences themselves.
 *
 * Earlier passes each fixed a sentence that overstated what a parser
 * measured, and each fix introduced a new one of the same kind, because
 * nothing in the suite checked a claim against the code beside it —
 * findings-copy.test.js only checks shape and placeholder markers (see
 * its own header comment). This file is the structural fix: one
 * hand-written assertion per on-screen sentence that names a field, tying
 * the words to what the parser actually computed, across all five
 * platforms.
 *
 * Two halves:
 *   - PART A drives the real page (headless Chromium) with each platform's
 *     real fixture archive and reads the rendered .find cards out of the
 *     DOM — the same words a visitor sees.
 *   - PART B calls the Apple and X parser/findings modules directly with
 *     hand-built inputs Node can construct cheaply (a sign-in-free Apple
 *     export, an engagements-only X archive) to reach states the five
 *     fixtures don't produce on their own.
 *
 * Run with:
 *   NODE_PATH="<path to a node_modules containing playwright>" \
 *     node website/shadow/test/claims.test.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AppleParser = require('../parsers/apple.js');
const AppleFindings = require('../parsers/apple.findings.js');
const AppleFixtureData = require('../fixtures/apple/fixture-data.js');
const XParser = require('../parsers/x.js');
const XFindings = require('../parsers/x.findings.js');

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

// Drives one fixture zip through the real upload flow and returns the
// rendered .find cards as [{v, h, p}] — h and p as rendered textContent, so
// this reads exactly what a visitor's screen shows, not the source object.
async function renderFixture(page, origin, zipRelPath) {
  const zipPath = path.join(SHADOW, 'fixtures', zipRelPath);
  assert.ok(fs.existsSync(zipPath), `fixture missing: ${zipPath}`);
  await page.goto(`${origin}/shadow/index.html`, { waitUntil: 'networkidle' });
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pick')]);
  await fileChooser.setFiles(zipPath);
  await page.waitForFunction(() => document.querySelector('#finds').style.display === 'block', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => {
    return [...document.querySelectorAll('.find')].map((el) => ({
      v: el.querySelector('.v')?.textContent || '',
      h: el.querySelector('.h')?.textContent || '',
      p: el.querySelector('p')?.textContent || '',
    }));
  });
}

function findCard(cards, v) {
  return cards.find((c) => c.v === v);
}

async function main() {
  // ---- PART A: real fixtures through the real page ------------------------
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

    // 1. Reddit — "The messages" card: only the count was read. Must say
    // "count", must never say "date" — reddit.js's messages.csv branch
    // reads no date at all (see reddit.js's classify(), the "d" key).
    {
      const cards = await renderFixture(page, origin, path.join('reddit', 'reddit-export.zip'));
      const card = findCard(cards, 'The messages');
      assert.ok(card, 'expected a "The messages" card from the Reddit fixture (it carries 3 messages)');
      assert.ok(/only the count/i.test(card.p), `Reddit messages card must say only the count was read — got: "${card.p}"`);
      assert.ok(
        !/count and the date were read|date only places/i.test(card.p),
        `Reddit messages card must not claim the date was read — reddit.js's messages.csv branch reads no date — got: "${card.p}"`
      );
    }
    console.log('PASS — Reddit "The messages" card names the count and never the date.');

    // 2. Apple — "The trail" card: sourced from sign-in records only.
    // apple.js's locationDays is gated on cat.key === 'signIn'
    // (classifyRecords()); the card's own words must say so.
    {
      const cards = await renderFixture(page, origin, path.join('apple', 'apple-export.zip'));
      const card = findCard(cards, 'The trail');
      assert.ok(card, 'expected a "The trail" card from the Apple fixture (it carries sign-in records)');
      assert.ok(/sign-in/i.test(card.h), `Apple trail headline must name sign-in as its source — got: "${card.h}"`);
      assert.ok(/sign-in/i.test(card.p), `Apple trail paragraph must name sign-in as its source — got: "${card.p}"`);
    }
    console.log('PASS — Apple "The trail" card names sign-in records as its source.');

    // 3. Google — "The products" card: names what google.js actually found
    // (Search, YouTube, Maps, Ads per fixtures/google/fixture-data.js), and
    // never says "bundled" — a Takeout export can hold products this parser
    // never opens, so a count must never imply it speaks for all of them.
    {
      const cards = await renderFixture(page, origin, path.join('google', 'google-export.zip'));
      const card = findCard(cards, 'The products');
      assert.ok(card, 'expected a "The products" card from the Google fixture');
      for (const name of ['Search', 'YouTube', 'Maps', 'Ads']) {
        assert.ok(card.h.includes(name), `Google products headline must name "${name}" — got: "${card.h}"`);
      }
      assert.ok(!/bundled/i.test(card.h) && !/bundled/i.test(card.p), `Google products card must never say "bundled" — got h:"${card.h}" p:"${card.p}"`);

      // Google's own "The list" card must not borrow Meta's contact-details
      // claim — Takeout's Ads activity only says an ad was shown, not that
      // the advertiser held your contact details (index.html's isGoogleSourced branch).
      const listCard = findCard(cards, 'The list');
      assert.ok(listCard, 'expected a "The list" card from the Google fixture (it carries advertiser names)');
      // The headline is the claim itself; the paragraph is allowed to name
      // Meta's claim only as an explicit contrast ("that is not Meta's
      // list..."), which is a stronger, more honest statement than silence.
      assert.ok(
        !/uploaded your contact details/i.test(listCard.h),
        `Google's "The list" headline must not borrow Meta's contact-details claim — got: "${listCard.h}"`
      );
      assert.ok(
        /that is not meta.s list/i.test(listCard.p),
        `Google's "The list" paragraph must explicitly disclaim Meta's contact-details mechanism, not merely omit it — got: "${listCard.p}"`
      );
    }
    console.log('PASS — Google "The products" card names its products, never "bundled"; Google\'s "The list" card does not borrow Meta\'s claim.');

    // 4. Meta — "The list" card: the one platform whose export really is a
    // business uploading a contact list with the reader in it (Custom
    // Audiences) — see index.html's isGoogleSourced branch comment.
    {
      const cards = await renderFixture(page, origin, path.join('meta', 'meta-export.zip'));
      const card = findCard(cards, 'The list');
      assert.ok(card, 'expected a "The list" card from the Meta fixture (it carries advertiser names)');
      assert.ok(
        /uploaded your contact details/i.test(card.h),
        `Meta's "The list" card must say a company uploaded contact details — got: "${card.h}"`
      );
    }
    console.log('PASS — Meta "The list" card says "uploaded your contact details".');

    // 5. X — "The engagements" card must appear on a real-shaped archive.
    // extractAdvertiserName() used to only read the flat
    // rec.advertiserInfo shape; the documented shape (GDPRAds.d.ts) nests
    // it under rec.impressionAttributes.advertiserInfo, so a real X export
    // produced adEngagementCounts = {} and no card at all. The fixture now
    // carries one record in each shape.
    {
      const cards = await renderFixture(page, origin, path.join('x', 'x-export.zip'));
      const card = findCard(cards, 'The engagements');
      assert.ok(card, 'expected "The engagements" card on the X fixture now that both advertiser-name shapes are read');
    }
    console.log('PASS — X "The engagements" card appears on the real-shaped fixture archive.');
  } finally {
    await browser.close();
    server.close();
  }

  // ---- PART B: hand-built inputs the five fixtures don't reach on their own --

  // 6. Apple — no sign-in file anywhere in the archive must yield no "The
  // trail" card at all (not just an unlabelled zero) — same PoC shape as
  // apple.test.js #13, re-asserted here as a claim rather than a count.
  {
    const appStoreWithRegion = AppleFixtureData.toCsv(
      ['Item Type', 'Item Title', 'Event', 'Event Date', 'Region'],
      [
        ['App', 'Fictitious Weather App', 'Download', '2021-01-01T00:00:00Z', 'US'],
        ['App', 'Imaginary Notes App', 'Update', '2021-06-01T00:00:00Z', 'DE'],
      ]
    );
    const noSignInResult = AppleParser.parseFromEntries([{ name: 'App Store/App Store Activity.csv', text: appStoreWithRegion }]);
    const trailCard = AppleFindings.buildFindings(noSignInResult).find((f) => f.v === 'The trail');
    assert.strictEqual(trailCard, undefined, 'expected no "The trail" card when the archive contains no sign-in file at all');
  }
  console.log('PASS — Apple: no sign-in file in the archive yields no "The trail" card.');

  // 7. X — an engagements-only archive (no ad-impressions.js at all) must
  // produce an "The engagements" card whose paragraph never says
  // "impressions above" — there is no impressions card on screen for it
  // to refer to (x.findings.js's canCompare gate).
  {
    const wrap = (name, part, value) => `window.YTD.${name}.part${part} = ${JSON.stringify(value)};`;
    const engagementsOnly = [
      {
        ad: {
          adsUserData: {
            adEngagements: {
              engagements: [
                { impressionAttributes: { advertiserInfo: { advertiserName: 'Fictional Outfitters Co.' } }, engagementAttributes: [{ engagementType: 'Click' }] },
              ],
            },
          },
        },
      },
    ];
    const r = XParser.parseFromEntries([{ name: 'data/ad-engagements.js', text: wrap('ad_engagements', 0, engagementsOnly) }]);
    const cards = XFindings.buildFindings(r);
    assert.strictEqual(findCard(cards, 'The impressions'), undefined, 'expected no "The impressions" card on an engagements-only archive');
    const engCard = findCard(cards, 'The engagements');
    assert.ok(engCard, 'expected "The engagements" card on an engagements-only archive');
    assert.ok(
      !/impressions above/i.test(engCard.p),
      `X engagements card must not reference "impressions above" when no impressions card is on screen — got: "${engCard.p}"`
    );
  }
  console.log('PASS — X: an engagements-only archive never says "impressions above".');

  // 8. X — no ad-engagements.js at all must produce no "The engagements"
  // card (the card is gated on adEngagementCounts being non-empty).
  {
    const r = XParser.parseFromEntries([]);
    const cards = XFindings.buildFindings(r);
    assert.strictEqual(findCard(cards, 'The engagements'), undefined, 'expected no "The engagements" card when no engagement records were read at all');
  }
  console.log('PASS — X: an archive with no engagement records produces no "The engagements" card.');

  // 9. Apple — "The rhythm" card must name only the categories actually
  // present in the export, never the fixed four-system list, on a
  // one-service (App Store-only) archive.
  {
    const rows = [];
    for (let i = 0; i < 45; i++) {
      const month = String(1 + (i % 12)).padStart(2, '0');
      const day = String(1 + (i % 27)).padStart(2, '0');
      rows.push(['App', `Fictitious App ${i}`, 'Open', `2022-${month}-${day}T${String(i % 24).padStart(2, '0')}:00:00Z`]);
    }
    const appStoreOnlyCsv = AppleFixtureData.toCsv(['Item Type', 'Item Title', 'Event', 'Event Date'], rows);
    const r = AppleParser.parseFromEntries([{ name: 'App Store/App Store Activity.csv', text: appStoreOnlyCsv }]);
    assert.strictEqual(r.services.length, 1, `expected exactly one service on an App Store-only archive, got: ${JSON.stringify(r.services)}`);
    const card = AppleFindings.buildFindings(r).find((f) => f.v === 'The rhythm');
    assert.ok(card, 'expected "The rhythm" card on a 45-event App Store-only archive');
    assert.ok(/App Store/.test(card.p), `Apple rhythm paragraph must name the one present category ("App Store") — got: "${card.p}"`);
    for (const absent of ['Apple Media Services', 'sign-in', 'iCloud']) {
      assert.ok(
        !new RegExp(absent, 'i').test(card.p),
        `Apple rhythm paragraph must not name "${absent}" when the export holds only App Store records — got: "${card.p}"`
      );
    }
  }
  console.log('PASS — Apple "The rhythm" card names only the categories actually present (App Store only), never the fixed four-system list.');

  // 10. fmtSpan() across all four copies (index.html, and the Apple/X/Reddit
  // findings modules) must print "1 year", never "1 years", for any span
  // that rounds to 1.0 years.
  {
    const oneYearSeconds = 31557600; // exactly 1.0 by fmtSpan's own (s/31557600).toFixed(1)
    const label = AppleFindings._internal.fmtSpan(oneYearSeconds);
    assert.strictEqual(label, '1 year', `Apple findings fmtSpan(1 year of seconds) must read "1 year" — got: "${label}"`);
    const XFindingsModule = require('../parsers/x.findings.js');
    const RedditFindings = require('../parsers/reddit.findings.js');
    assert.strictEqual(
      XFindingsModule._internal.fmtSpan(oneYearSeconds),
      '1 year',
      `X findings fmtSpan(1 year of seconds) must read "1 year" — got: "${XFindingsModule._internal.fmtSpan(oneYearSeconds)}"`
    );
    assert.strictEqual(
      RedditFindings._internal.fmtSpan(oneYearSeconds),
      '1 year',
      `Reddit findings fmtSpan(1 year of seconds) must read "1 year" — got: "${RedditFindings._internal.fmtSpan(oneYearSeconds)}"`
    );
    // index.html's own copy is not require()-able (it is a <script> block,
    // not a module) — checked live, through the rendered page, in step 11.
  }
  console.log('PASS — fmtSpan() prints "1 year" (singular), not "1 years", in the Apple/X/Reddit findings modules.');

  // 11. Same singular-year check against index.html's own fmtSpan(), live
  // through the rendered page — a ~1.0-year, 60-event App Store-only Apple
  // archive must render "1 year, 60 recorded events" in "The span" card.
  {
    const rows = [];
    for (let i = 0; i < 60; i++) {
      const dayOffset = Math.floor((i / 59) * 365); // spread across ~1 year
      const d = new Date(Date.UTC(2022, 0, 1) + dayOffset * 86400000);
      rows.push(['App', `Fictitious App ${i}`, 'Open', d.toISOString()]);
    }
    const oneYearCsv = AppleFixtureData.toCsv(['Item Type', 'Item Title', 'Event', 'Event Date'], rows);
    const zip = new (require('../vendor/jszip.min.js'))();
    zip.file('App Store/App Store Activity.csv', oneYearCsv);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const tmpZip = path.join(SHADOW, 'fixtures', 'apple', 'apple-one-year-export.zip');
    fs.writeFileSync(tmpZip, buf);

    const server2 = await startServer();
    const { port: port2 } = server2.address();
    const origin2 = `http://127.0.0.1:${port2}`;
    let browser2;
    try {
      browser2 = await playwright.chromium.launch();
    } catch (e) {
      browser2 = await playwright.chromium.launch({ channel: 'chrome' });
    }
    try {
      const page2 = await browser2.newPage();
      const cards = await renderFixture(page2, origin2, path.join('apple', 'apple-one-year-export.zip'));
      const spanCard = findCard(cards, 'The span');
      assert.ok(spanCard, 'expected "The span" card on the one-year Apple fixture');
      assert.ok(!/\b1 years\b/.test(spanCard.h), `expected no "1 years" (must be singular) — got: "${spanCard.h}"`);
      assert.ok(/\b1 year\b/.test(spanCard.h), `expected "1 year" in the span headline — got: "${spanCard.h}"`);
    } finally {
      await browser2.close();
      server2.close();
      fs.unlinkSync(tmpZip);
    }
  }
  console.log('PASS — index.html\'s own fmtSpan() prints "1 year" live on a ~1-year Apple export.');

  console.log('PASS — all claim assertions tie the on-screen sentence to what the parser measured, across all five platforms.');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
