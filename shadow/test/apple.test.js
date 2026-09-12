/* Falsifiability test for website/shadow/parsers/apple.js.
 *
 * Loads the synthetic fixture at fixtures/apple/apple-export.zip (rebuild
 * it with `node fixtures/apple/build-fixture.js` if fixture-data.js
 * changes) and asserts the parser's counts against fixture-data.js's
 * EXPECTED block. Also asserts the routing negatives in both directions
 * against both the Meta and the Google fixtures.
 *
 * No test framework — Node's built-in assert is enough for one file. Run:
 *   node website/shadow/test/apple.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const AppleParser = require('../parsers/apple.js');
const AppleFindings = require('../parsers/apple.findings.js');
const MetaParser = require('../parsers/meta.js');
const GoogleParser = require('../parsers/google.js');
const D = require('../fixtures/apple/fixture-data.js');

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'apple', 'apple-export.zip');
  assert.ok(fs.existsSync(zipPath), 'fixture missing — run: node fixtures/apple/build-fixture.js');

  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // 1. isAppleExport() must recognize this archive from its own shape.
  assert.strictEqual(AppleParser.isAppleExport(names), true, 'isAppleExport() should detect the fixture archive');

  // A decoy archive with none of the Apple category hints must not be
  // misdetected.
  assert.strictEqual(
    AppleParser.isAppleExport(['random/export.json', 'random/products.csv']),
    false,
    'isAppleExport() should not fire on an unrelated file list'
  );

  const r = await AppleParser.parseArchive(zip);

  // 2. Services — one per category actually read: App Store, Apple Media
  // Services (deduplicated across its CSV and JSON files), Apple ID
  // sign-in history, iCloud Drive.
  assert.strictEqual(r.services.length, D.EXPECTED.serviceCount, `expected ${D.EXPECTED.serviceCount} services, got ${r.services.length}`);
  D.EXPECTED.services.forEach((s) => assert.ok(r.services.includes(s), `missing service: ${s}`));

  // 3. Events — every record with a parseable date-ish column, across all
  // five files (three CSV, one JSON, one more CSV).
  assert.strictEqual(r.eventCount, D.EXPECTED.eventCount, `expected ${D.EXPECTED.eventCount} events, got ${r.eventCount}`);

  // 4. Location days — distinct calendar dates from Sign-In History's
  // Location column only, never double-counting two sign-ins on the same
  // day, and never counting the row whose Location is blank.
  assert.strictEqual(r.locationDays, D.EXPECTED.locationDays, `expected ${D.EXPECTED.locationDays} location days, got ${r.locationDays}`);

  // 5. The timestamp span — pooled across all four categories.
  assert.ok(r.span, 'expected a timestamp span to be computed');
  const expectMin = D.iso(D.EXPECTED.spanMinIso);
  const expectMax = D.iso(D.EXPECTED.spanMaxIso);
  assert.strictEqual(r.span.min, expectMin, `expected span.min ${expectMin} (${D.EXPECTED.spanMinIso}), got ${r.span.min}`);
  assert.strictEqual(r.span.max, expectMax, `expected span.max ${expectMax} (${D.EXPECTED.spanMaxIso}), got ${r.span.max}`);

  // 6. Files scanned/matched — only the five relevant-shaped files; Mail,
  // the Photos placeholder, the Messages export, and the stray App Store
  // Terms.pdf are never opened at all.
  assert.strictEqual(r.filesScanned, D.EXPECTED.filesScanned, `expected ${D.EXPECTED.filesScanned} files scanned, got ${r.filesScanned}`);
  assert.strictEqual(r.filesMatched, D.EXPECTED.filesMatched, `expected ${D.EXPECTED.filesMatched} files matched, got ${r.filesMatched}`);

  // 7. Routing negatives, both directions, against both other real fixture
  // archives — built and checked against the REAL fixture zips, not a
  // hand-rolled name list, so this fails if any two parsers' detectors
  // ever overlap in practice.
  {
    const metaZipPath = path.join(__dirname, '..', 'fixtures', 'meta', 'meta-export.zip');
    assert.ok(fs.existsSync(metaZipPath), 'Meta fixture missing — run: node fixtures/meta/build-fixture.js');
    const metaBuf = fs.readFileSync(metaZipPath);
    const metaZip = await JSZip.loadAsync(metaBuf);
    const metaNames = Object.keys(metaZip.files).filter((n) => !metaZip.files[n].dir);

    const googleZipPath = path.join(__dirname, '..', 'fixtures', 'google', 'google-export.zip');
    assert.ok(fs.existsSync(googleZipPath), 'Google fixture missing — run: node fixtures/google/build-fixture.js');
    const googleBuf = fs.readFileSync(googleZipPath);
    const googleZip = await JSZip.loadAsync(googleBuf);
    const googleNames = Object.keys(googleZip.files).filter((n) => !googleZip.files[n].dir);

    assert.strictEqual(AppleParser.isAppleExport(metaNames), false, 'the Meta fixture archive must not be routed to the Apple parser');
    assert.strictEqual(AppleParser.isAppleExport(googleNames), false, 'the Google fixture archive must not be routed to the Apple parser');
    assert.strictEqual(MetaParser.isMetaExport(names), false, 'the Apple fixture archive must not be routed to the Meta parser');
    assert.strictEqual(GoogleParser.isGoogleExport(names), false, 'the Apple fixture archive must not be routed to the Google parser');
  }
  console.log('PASS — routing: Apple, Meta, and Google fixtures do not cross-route in either direction.');

  // 8. Size caps, checked before inflation — a per-file cap. Same technique
  // as google.test.js/meta.test.js: override the declared size JSZip
  // populates from the zip's central directory, and spy on .async() to
  // prove the oversized entry is never inflated.
  {
    const capZip = new JSZip();
    capZip.file('App Store/App Store Activity.csv', D.toCsv(['Item Type', 'Item Title', 'Event', 'Event Date'], [['App', 'ok', 'Download', '2021-01-01T00:00:00Z']]));
    capZip.file('iCloud Drive/iCloud Drive Files.csv', D.toCsv(['File Name', 'File Size (Bytes)', 'Last Modified Date'], [['ok.txt', '10', '2021-01-01T00:00:00Z']]));
    const buf2 = await capZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf2);

    const oversizedEntry = loaded.files['iCloud Drive/iCloud Drive Files.csv'];
    oversizedEntry._data.uncompressedSize = AppleParser.SIZE_CAPS.PER_FILE_BYTES + 1024;
    let oversizedAsyncCalls = 0;
    const realAsync = oversizedEntry.async.bind(oversizedEntry);
    oversizedEntry.async = function (...args) {
      oversizedAsyncCalls++;
      return realAsync(...args);
    };

    const capResult = await AppleParser.parseArchive(loaded);
    assert.strictEqual(oversizedAsyncCalls, 0, 'entry above the per-file cap must never be inflated');
    assert.strictEqual(capResult.filesScanned, 1, 'only the small, real entry should have been scanned');
    assert.strictEqual(capResult.skipped.length, 1, 'expected one entry recorded as skipped');
    assert.strictEqual(capResult.skipped[0].name, 'iCloud Drive/iCloud Drive Files.csv');
    assert.strictEqual(capResult.skipped[0].bytes, AppleParser.SIZE_CAPS.PER_FILE_BYTES + 1024);
  }

  // 9. Size caps — a total cap. Twelve small, real App Store entries;
  // declared sizes overridden so eleven fit under the 500 MB total cap
  // (11 x 45 MB = 495 MB) and the twelfth pushes it over (540 MB).
  {
    const totalZip = new JSZip();
    const names2 = [];
    for (let i = 0; i < 12; i++) {
      const name = `App Store/App Store Activity ${String(i).padStart(2, '0')}.csv`;
      names2.push(name);
      totalZip.file(name, D.toCsv(['Item Type', 'Item Title', 'Event', 'Event Date'], [['App', 'ok', 'Download', '2021-01-01T00:00:00Z']]));
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
      await AppleParser.parseArchive(loaded);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'expected parseArchive() to reject once the total cap is crossed');
    assert.strictEqual(threw.code, 'SIZE_CAP_EXCEEDED', 'expected the SIZE_CAP_EXCEEDED error code');
    for (let i = 0; i < 11; i++) assert.strictEqual(asyncCalls[names2[i]], 1, `${names2[i]} should have been inflated`);
    assert.strictEqual(asyncCalls[names2[11]], 0, `${names2[11]} should never have been inflated`);
  }
  console.log('PASS — size caps: per-file and total caps both refuse before inflation.');

  // 10. Out-of-scope content — Mail, Photos, Messages, and the stray PDF
  // sitting inside a real category folder — must never be opened, even
  // though at least one of them (Messages Export.json) is valid JSON.
  {
    let calls = 0;
    const outOfScope = names.filter((n) => !AppleParser._internal.looksRelevantByPath(n));
    assert.ok(outOfScope.length >= 4, 'expected at least the four decoy files to be out of scope');
    outOfScope.forEach((n) => {
      const entry = zip.files[n];
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        calls++;
        return realAsync(...args);
      };
    });
    await AppleParser.parseArchive(zip);
    assert.strictEqual(calls, 0, `expected zero out-of-scope files inflated, got ${calls}`);
  }
  console.log('PASS — Mail, Photos, Messages, and a stray PDF are never opened.');

  // 11. Malformed-record tolerance — a Sign-In History CSV with one row
  // missing a column (parses to the wrong field count) and one row whose
  // date column is not a date at all must still be recognized as a
  // sign-in file, and must count the good rows rather than zero.
  {
    const header = 'Sign In Date,Device,Location\r\n';
    const goodRow = (n) => `2021-0${(n % 9) + 1}-01T00:00:00Z,Device ${n},\r\n`;
    let csv = header;
    for (let i = 0; i < 50; i++) csv += goodRow(i);
    csv += 'not a date at all,Some Device,\r\n'; // bad: date column unparsable
    csv += 'Device with,too,many,commas,unquoted\r\n'; // bad: wrong column count
    const malformedResult = AppleParser.parseFromEntries([
      { name: 'Apple ID Account and Device Information/Sign-In History.csv', text: csv },
    ]);
    assert.strictEqual(malformedResult.services.length, 1, 'expected the file to still be recognized as a sign-in file despite two bad rows');
    assert.strictEqual(malformedResult.eventCount, 50, `expected 50 counted events, got ${malformedResult.eventCount}`);
    assert.strictEqual(malformedResult.skippedRecords, 2, `expected 2 skipped records noted, got ${malformedResult.skippedRecords}`);
  }
  console.log('PASS — a malformed row is skipped and counted, not treated as a reason to drop the whole file.');

  // 12. HTML-vs-data analogue — a category present only as .pdf, with no
  // .csv/.json file for that same category, must be diagnosable from the
  // file list alone, the same way google.js's looksLikeHtmlExport() covers
  // an HTML-only Takeout.
  {
    assert.strictEqual(
      AppleParser.looksLikeUnreadableExport(['Apple Media Services Information/Apple Media Services Information.pdf']),
      true,
      'expected a PDF-only category to be detected as unreadable'
    );
    assert.strictEqual(
      AppleParser.looksLikeUnreadableExport(names),
      false,
      'the real (CSV/JSON) fixture must not be misdetected as unreadable, even though it also carries a stray PDF'
    );
  }
  console.log('PASS — a PDF-only category is distinguishable from a CSV/JSON one by its file list.');

  // 13. Location days must come from sign-in records only. An App Store
  // CSV carrying a "Region" column, with NO sign-in file anywhere in the
  // archive, must yield zero location days and produce no "The trail"
  // card — not the 18-day false positive a "Region" column on an
  // unrelated file used to produce.
  {
    const appStoreWithRegion = D.toCsv(
      ['Item Type', 'Item Title', 'Event', 'Event Date', 'Region'],
      [
        ['App', 'Fictitious Weather App', 'Download', '2021-01-01T00:00:00Z', 'US'],
        ['App', 'Imaginary Notes App', 'Update', '2021-06-01T00:00:00Z', 'DE'],
      ]
    );
    const noSignInResult = AppleParser.parseFromEntries([
      { name: 'App Store/App Store Activity.csv', text: appStoreWithRegion },
    ]);
    assert.strictEqual(
      noSignInResult.locationDays,
      0,
      `expected 0 location days from an App Store file with no sign-in file present, got ${noSignInResult.locationDays}`
    );
    assert.deepStrictEqual(
      noSignInResult.services,
      ['App Store'],
      'expected only "App Store" to be recognized, confirming no sign-in file was present'
    );
    const trailCard = AppleFindings.buildFindings(noSignInResult).find((f) => f.v === 'The trail');
    assert.strictEqual(
      trailCard,
      undefined,
      'expected no "The trail" card when no sign-in file was ever read'
    );
  }
  console.log('PASS — a Region column on App Store activity, with no sign-in file present, yields zero location days and no "The trail" card.');

  console.log('PASS — apple.js parser:');
  console.log(`  services: ${r.services.length} (${r.services.join(', ')})`);
  console.log(`  events: ${r.eventCount}`);
  console.log(`  location days: ${r.locationDays}`);
  console.log(`  span: ${new Date(r.span.min * 1000).toISOString()} .. ${new Date(r.span.max * 1000).toISOString()}`);
  console.log(`  files scanned: ${r.filesScanned}, matched: ${r.filesMatched}`);
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
