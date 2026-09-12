/* Falsifiability test for website/shadow/parsers/google.js.
 *
 * Loads the synthetic fixture at fixtures/google/google-export.zip (rebuild
 * it with `node fixtures/google/build-fixture.js` if fixture-data.js
 * changes) and asserts the parser's counts against fixture-data.js's
 * EXPECTED block. Also asserts the routing negative in both directions: the
 * Meta fixture must not be recognized as Google, and the Google fixture
 * must not be recognized as Meta.
 *
 * No test framework — Node's built-in assert is enough for one file. Run:
 *   node website/shadow/test/google.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const GoogleParser = require('../parsers/google.js');
const MetaParser = require('../parsers/meta.js');
const D = require('../fixtures/google/fixture-data.js');

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'google', 'google-export.zip');
  assert.ok(fs.existsSync(zipPath), `fixture missing — run: node fixtures/google/build-fixture.js`);

  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // 1. isGoogleExport() must recognize this archive from its tree shape.
  assert.strictEqual(GoogleParser.isGoogleExport(names), true, 'isGoogleExport() should detect the fixture archive');

  // A decoy archive with none of the Takeout hints must not be misdetected.
  assert.strictEqual(
    GoogleParser.isGoogleExport(['random/export.json', 'random/products.json']),
    false,
    'isGoogleExport() should not fire on an unrelated file list'
  );

  const r = await GoogleParser.parseArchive(zip);

  // 2. Products — one per My Activity folder, plus YouTube (from the
  // history files) and Ads (from the top-level Ads/ form), deduplicated.
  assert.strictEqual(r.products.length, D.EXPECTED.productCount, `expected ${D.EXPECTED.productCount} products, got ${r.products.length}`);
  D.EXPECTED.products.forEach((p) => assert.ok(r.products.includes(p), `missing product: ${p}`));

  // 3. Events — every activity-shaped record across My Activity, the
  // top-level Ads form, and both YouTube history files.
  assert.strictEqual(r.eventCount, D.EXPECTED.eventCount, `expected ${D.EXPECTED.eventCount} events, got ${r.eventCount}`);

  // 4. Advertisers — deduplicated across the two Ads-shaped files.
  assert.strictEqual(
    r.advertisers.length,
    D.EXPECTED.advertiserCount,
    `expected ${D.EXPECTED.advertiserCount} unique advertisers, got ${r.advertisers.length}`
  );
  D.EXPECTED.advertisers.forEach((name) => assert.ok(r.advertisers.includes(name), `missing advertiser: ${name}`));

  // 5. Location days — distinct calendar dates across Records.json (mixed
  // timestampMs/timestamp field shapes) and Semantic Location History,
  // pooled together, never double-counting two points on the same day.
  assert.strictEqual(r.locationDays, D.EXPECTED.locationDays, `expected ${D.EXPECTED.locationDays} location days, got ${r.locationDays}`);

  // 6. The timestamp span — pooled across activity AND location, so a
  // location point can set the overall min or max just as an activity
  // event can (the fixture's own latest point is a location record, not an
  // activity one).
  assert.ok(r.span, 'expected a timestamp span to be computed');
  const expectMin = D.iso(D.EXPECTED.spanMinIso);
  const expectMax = D.iso(D.EXPECTED.spanMaxIso);
  assert.strictEqual(r.span.min, expectMin, `expected span.min ${expectMin} (${D.EXPECTED.spanMinIso}), got ${r.span.min}`);
  assert.strictEqual(r.span.max, expectMax, `expected span.max ${expectMax} (${D.EXPECTED.spanMaxIso}), got ${r.span.max}`);

  // 6b. Semantic Location History, isolated — a direct, non-trivial check
  // that SEMANTIC_LOCATION_RE matches Google's real nested path
  // (Takeout/Location History/Semantic Location History/...), not just the
  // parser's own former assumption. Parses ONLY the semantic-location file
  // (no Records.json in the mix) through the public parseFromEntries()
  // entry point and asserts its two distinct days are found — a fixture
  // built to the wrong (bare-root) path would report zero here, exactly
  // the failure mode that was once invisible to the old suite.
  {
    const semanticOnly = GoogleParser.parseFromEntries([
      {
        name: 'Takeout/Location History/Semantic Location History/2022/2022_MARCH.json',
        text: JSON.stringify({ timelineObjects: D.semanticTimeline }),
      },
    ]);
    assert.strictEqual(
      semanticOnly.locationDays,
      2,
      `expected 2 days from Semantic Location History alone (2022-03-05, 2022-03-20), got ${semanticOnly.locationDays}`
    );
  }
  console.log('PASS — semantic-location days are non-trivially exercised via the real nested Takeout path.');

  // 7. Files scanned/matched — only the nine relevant-shaped files; the
  // Gmail mbox, Drive placeholder, Photos sidecar JSON, and Takeout's own
  // manifest are never opened at all.
  assert.strictEqual(r.filesScanned, D.EXPECTED.filesScanned, `expected ${D.EXPECTED.filesScanned} files scanned, got ${r.filesScanned}`);
  assert.strictEqual(r.filesMatched, D.EXPECTED.filesMatched, `expected ${D.EXPECTED.filesMatched} files matched, got ${r.filesMatched}`);

  // 8. Routing negative, direction one: the Meta fixture must not route to
  // Google. Built and checked against the REAL Meta fixture archive, not a
  // hand-rolled name list, so this fails if the two parsers' detectors ever
  // overlap in practice.
  {
    const metaZipPath = path.join(__dirname, '..', 'fixtures', 'meta', 'meta-export.zip');
    assert.ok(fs.existsSync(metaZipPath), 'Meta fixture missing — run: node fixtures/meta/build-fixture.js');
    const metaBuf = fs.readFileSync(metaZipPath);
    const metaZip = await JSZip.loadAsync(metaBuf);
    const metaNames = Object.keys(metaZip.files).filter((n) => !metaZip.files[n].dir);
    assert.strictEqual(
      GoogleParser.isGoogleExport(metaNames),
      false,
      'the Meta fixture archive must not be routed to the Google parser'
    );
  }

  // 9. Routing negative, direction two: the Google fixture must not route
  // to Meta.
  assert.strictEqual(
    MetaParser.isMetaExport(names),
    false,
    'the Google fixture archive must not be routed to the Meta parser'
  );

  // 10. Size caps, checked before inflation — a per-file cap. Same technique
  // as meta.test.js: override the declared size JSZip populates from the
  // zip's central directory, and spy on .async() to prove the oversized
  // entry is never inflated.
  {
    const capZip = new JSZip();
    capZip.file('Takeout/My Activity/Search/MyActivity.json', JSON.stringify([{ header: 'Search', title: 'ok', time: '2021-01-01T00:00:00.000Z', products: ['Search'] }]));
    capZip.file('Takeout/My Activity/Ads/MyActivity.json', JSON.stringify([{ header: 'Ads', title: 'ok', time: '2021-01-01T00:00:00.000Z', products: ['Ads'] }]));
    const buf2 = await capZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf2);

    const oversizedEntry = loaded.files['Takeout/My Activity/Ads/MyActivity.json'];
    oversizedEntry._data.uncompressedSize = GoogleParser.SIZE_CAPS.PER_FILE_BYTES + 1024;
    let oversizedAsyncCalls = 0;
    const realAsync = oversizedEntry.async.bind(oversizedEntry);
    oversizedEntry.async = function (...args) {
      oversizedAsyncCalls++;
      return realAsync(...args);
    };

    const capResult = await GoogleParser.parseArchive(loaded);
    assert.strictEqual(oversizedAsyncCalls, 0, 'entry above the per-file cap must never be inflated');
    assert.strictEqual(capResult.filesScanned, 1, 'only the small, real entry should have been scanned');
    // A refused entry must be reported, not just silently dropped, so the
    // page can say what was skipped and how large it was.
    assert.strictEqual(capResult.skipped.length, 1, 'expected one entry recorded as skipped');
    assert.strictEqual(capResult.skipped[0].name, 'Takeout/My Activity/Ads/MyActivity.json');
    assert.strictEqual(capResult.skipped[0].bytes, GoogleParser.SIZE_CAPS.PER_FILE_BYTES + 1024);
  }

  // 11. Size caps — a total cap. Twelve small, real My Activity entries;
  // declared sizes overridden so eleven fit under the 500 MB total cap
  // (11 x 45 MB = 495 MB) and the twelfth pushes it over (540 MB).
  {
    const totalZip = new JSZip();
    const names2 = [];
    for (let i = 0; i < 12; i++) {
      const name = `Takeout/My Activity/Product${String(i).padStart(2, '0')}/MyActivity.json`;
      names2.push(name);
      totalZip.file(name, JSON.stringify([{ header: 'Search', title: 'ok', time: '2021-01-01T00:00:00.000Z', products: ['Search'] }]));
    }
    const buf3 = await totalZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf3);

    const FORTY_FIVE_MB = 45 * 1024 * 1024;
    const asyncCalls = {};
    names2.forEach((name) => {
      const entry = loaded.files[name];
      entry._data.uncompressedSize = FORTY_FIVE_MB;
      asyncCalls[name] = 0;
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        asyncCalls[name]++;
        return realAsync(...args);
      };
    });

    let threw = null;
    try {
      await GoogleParser.parseArchive(loaded);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'expected parseArchive() to reject once the total cap is crossed');
    assert.strictEqual(threw.code, 'SIZE_CAP_EXCEEDED', 'expected the SIZE_CAP_EXCEEDED error code');
    for (let i = 0; i < 11; i++) assert.strictEqual(asyncCalls[names2[i]], 1, `${names2[i]} should have been inflated`);
    assert.strictEqual(asyncCalls[names2[11]], 0, `${names2[11]} should never have been inflated`);
  }

  // 12. Out-of-scope content — Gmail, Drive, Google Photos sidecars, and
  // Takeout's own manifest — must never be opened, even when their JSON (or
  // JSON-shaped) content would otherwise parse. Verified directly: spy on
  // .async() for every non-relevant entry and confirm it is never called.
  {
    let calls = 0;
    const outOfScope = names.filter((n) => !GoogleParser._internal.looksRelevantByPath(n));
    assert.ok(outOfScope.length >= 4, 'expected at least the four decoy files to be out of scope');
    outOfScope.forEach((n) => {
      const entry = zip.files[n];
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        calls++;
        return realAsync(...args);
      };
    });
    await GoogleParser.parseArchive(zip);
    assert.strictEqual(calls, 0, `expected zero out-of-scope files inflated, got ${calls}`);
  }

  // 13. A malformed record must not void the whole file. A 1,000-row
  // MyActivity.json with one row missing "time" and one row with
  // time: null must still be recognized as an activity file, and must
  // count the 998 good rows rather than zero.
  {
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      rows.push({ header: 'Search', title: `row ${i}`, time: `2021-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, products: ['Search'] });
    }
    rows[500] = { header: 'Search', title: 'missing time' }; // no "time" field at all
    rows[600] = { header: 'Search', title: 'null time', time: null };
    const malformedResult = GoogleParser.parseFromEntries([
      { name: 'Takeout/My Activity/Search/MyActivity.json', text: JSON.stringify(rows) },
    ]);
    assert.strictEqual(malformedResult.products.length, 1, 'expected the file to still be recognized as an activity file despite two bad rows');
    assert.strictEqual(malformedResult.eventCount, 998, `expected 998 counted events (1000 - 2 malformed), got ${malformedResult.eventCount}`);
    assert.strictEqual(malformedResult.skippedRecords, 2, `expected 2 skipped records noted, got ${malformedResult.skippedRecords}`);
  }
  console.log('PASS — a malformed record is skipped and counted, not treated as a reason to drop the whole file.');

  // 14. An HTML-format Takeout (History exported as HTML instead of JSON)
  // must be diagnosable from its file list alone.
  {
    assert.strictEqual(
      GoogleParser.looksLikeHtmlExport(['Takeout/archive_browser.html', 'Takeout/My Activity/Search/MyActivity.html']),
      true,
      'expected an HTML My Activity export to be detected'
    );
    assert.strictEqual(
      GoogleParser.looksLikeHtmlExport(names),
      false,
      'the real (JSON) fixture must not be misdetected as an HTML export'
    );
  }
  console.log('PASS — an HTML-format Takeout is distinguishable from a JSON one by its file list.');

  console.log('PASS — google.js parser:');
  console.log(`  products: ${r.products.length} (${r.products.join(', ')})`);
  console.log(`  events: ${r.eventCount}`);
  console.log(`  advertisers: ${r.advertisers.length} (unique, across 2 Ads-shaped files)`);
  console.log(`  location days: ${r.locationDays}`);
  console.log(`  span: ${new Date(r.span.min * 1000).toISOString()} .. ${new Date(r.span.max * 1000).toISOString()}`);
  console.log(`  files scanned: ${r.filesScanned}, matched: ${r.filesMatched}`);
  console.log('  + routing: the Meta fixture does not route to Google, and the Google fixture does not route to Meta');
  console.log('  + per-file size cap: oversized entry refused, never inflated');
  console.log('  + total size cap: stopped mid-archive, refused entry never inflated');
  console.log('  + out-of-scope files (Gmail/Drive/Photos/manifest): never inflated');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
