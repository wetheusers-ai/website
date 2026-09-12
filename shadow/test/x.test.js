/* Falsifiability test for website/shadow/parsers/x.js.
 *
 * Loads the synthetic fixture at fixtures/x/x-export.zip (rebuild it with
 * `node fixtures/x/build-fixture.js` if fixture-data.js changes) and
 * asserts the parser's counts against fixture-data.js's EXPECTED block.
 * Also asserts the routing negative in both directions against the Meta
 * and Google fixtures, size-cap behavior before inflation, and malformed-
 * record tolerance.
 *
 * No test framework — Node's built-in assert is enough for one file. Run:
 *   node website/shadow/test/x.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const XParser = require('../parsers/x.js');
const MetaParser = require('../parsers/meta.js');
const GoogleParser = require('../parsers/google.js');
const D = require('../fixtures/x/fixture-data.js');

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'x', 'x-export.zip');
  assert.ok(fs.existsSync(zipPath), 'fixture missing — run: node fixtures/x/build-fixture.js');

  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // 1. isXExport() must recognize this archive from its own window.YTD
  // content shape — not from the file list alone.
  assert.strictEqual(await XParser.isXExport(zip, names), true, 'isXExport() should detect the fixture archive by content');

  // A decoy archive whose only data/*.js file is NOT window.YTD-wrapped
  // must not be misdetected — proves the check reads content, not just path.
  {
    const decoyZip = new JSZip();
    decoyZip.file('data/tweets.js', 'exports.notYtd = [1,2,3];');
    const decoyBuf = await decoyZip.generateAsync({ type: 'nodebuffer' });
    const decoyLoaded = await JSZip.loadAsync(decoyBuf);
    const decoyNames = Object.keys(decoyLoaded.files).filter((n) => !decoyLoaded.files[n].dir);
    assert.strictEqual(
      await XParser.isXExport(decoyLoaded, decoyNames),
      false,
      'a data/tweets.js that is not window.YTD-wrapped must not be detected as an X archive'
    );
  }

  // An unrelated file list with no data/*.js entries at all must not fire.
  assert.strictEqual(
    await XParser.isXExport(zip, ['random/export.json', 'random/products.json']),
    false,
    'isXExport() should not fire on a file list with no data/*.js candidates'
  );

  const r = await XParser.parseArchive(zip);

  // 2. Tweets — count and malformed-record tolerance.
  assert.strictEqual(r.tweetCount, D.EXPECTED.tweetCount, `expected ${D.EXPECTED.tweetCount} tweets, got ${r.tweetCount}`);

  // 3. Likes.
  assert.strictEqual(r.likeCount, D.EXPECTED.likeCount, `expected ${D.EXPECTED.likeCount} likes, got ${r.likeCount}`);

  // 4. Direct messages — counts only.
  assert.strictEqual(
    r.dmConversationCount,
    D.EXPECTED.dmConversationCount,
    `expected ${D.EXPECTED.dmConversationCount} DM conversations, got ${r.dmConversationCount}`
  );
  assert.strictEqual(
    r.dmMessageCount,
    D.EXPECTED.dmMessageCount,
    `expected ${D.EXPECTED.dmMessageCount} DM messages, got ${r.dmMessageCount}`
  );

  // 5. Ad impressions — advertiser names and per-advertiser counts.
  const impNames = Object.keys(r.adImpressionCounts);
  assert.strictEqual(
    impNames.length,
    D.EXPECTED.adImpressionAdvertiserCount,
    `expected ${D.EXPECTED.adImpressionAdvertiserCount} impression advertisers, got ${impNames.length}`
  );
  assert.strictEqual(r.adImpressionCounts['Fictional Outfitters Co.'], 2, 'expected 2 impressions for Fictional Outfitters Co.');
  assert.strictEqual(r.adImpressionCounts['Imaginary Kettle Traders'], 1, 'expected 1 impression for Imaginary Kettle Traders');
  const impTotal = impNames.reduce((s, n) => s + r.adImpressionCounts[n], 0);
  assert.strictEqual(impTotal, D.EXPECTED.adImpressionTotal, `expected ${D.EXPECTED.adImpressionTotal} total logged impressions, got ${impTotal}`);

  // 6. Ad engagements — separate mechanism, separate counts.
  const engNames = Object.keys(r.adEngagementCounts);
  assert.strictEqual(
    engNames.length,
    D.EXPECTED.adEngagementAdvertiserCount,
    `expected ${D.EXPECTED.adEngagementAdvertiserCount} engagement advertisers, got ${engNames.length}`
  );
  assert.strictEqual(r.adEngagementCounts['Fictional Outfitters Co.'], 1, 'expected 1 engagement for Fictional Outfitters Co.');
  assert.strictEqual(r.adEngagementCounts['Not Real Wireless Ltd.'], 1, 'expected 1 engagement for Not Real Wireless Ltd.');

  // 6b. The pooled, deduplicated advertiser list spans both mechanisms —
  // "Fictional Outfitters Co." appears in both and must not be doubled.
  assert.strictEqual(r.advertisers.length, 3, `expected 3 unique advertisers pooled across impressions+engagements, got ${r.advertisers.length}`);

  // 7. Owner, from account.js.
  assert.ok(r.owner, 'expected an owner to be identified from account.js');
  assert.strictEqual(r.owner.username, D.EXPECTED.ownerUsername);
  assert.strictEqual(r.owner.accountDisplayName, D.EXPECTED.ownerDisplayName);

  // 8. The timestamp span — tweets only (likes carry no timestamp).
  assert.ok(r.span, 'expected a timestamp span to be computed');
  const XParserInternal = XParser._internal;
  const expectMin = XParserInternal.toSecondsFromDateString(D.EXPECTED.spanMinIso);
  const expectMax = XParserInternal.toSecondsFromDateString(D.EXPECTED.spanMaxIso);
  assert.strictEqual(r.span.min, expectMin, `expected span.min ${expectMin}, got ${r.span.min}`);
  assert.strictEqual(r.span.max, expectMax, `expected span.max ${expectMax}, got ${r.span.max}`);

  // 9. Files scanned/matched — the two decoys are scanned (they sit at a
  // real data/*.js path) but never matched.
  assert.strictEqual(r.filesScanned, D.EXPECTED.filesScanned, `expected ${D.EXPECTED.filesScanned} files scanned, got ${r.filesScanned}`);
  assert.strictEqual(r.filesMatched, D.EXPECTED.filesMatched, `expected ${D.EXPECTED.filesMatched} files matched, got ${r.filesMatched}`);

  // 10. Malformed records inside real files are skipped and counted, not a
  // reason to drop the file — one bad row in tweets.js, one in like.js, one
  // ad-impressions record with no advertiser name.
  const expectedSkipped = D.EXPECTED.tweetSkipped + D.EXPECTED.likeSkipped + 1; // +1: the nameless impression record
  assert.strictEqual(r.skippedRecords, expectedSkipped, `expected ${expectedSkipped} skipped records, got ${r.skippedRecords}`);

  console.log('PASS — x.js parser:');
  console.log(`  tweets: ${r.tweetCount}, likes: ${r.likeCount}`);
  console.log(`  DMs: ${r.dmConversationCount} conversations, ${r.dmMessageCount} messages (counts only)`);
  console.log(`  ad impressions: ${impNames.length} advertisers (${impTotal} logged), ad engagements: ${engNames.length} advertisers`);
  console.log(`  owner: ${r.owner.username}`);
  console.log(`  span: ${new Date(r.span.min * 1000).toISOString()} .. ${new Date(r.span.max * 1000).toISOString()}`);
  console.log(`  files scanned: ${r.filesScanned}, matched: ${r.filesMatched}, skipped records: ${r.skippedRecords}`);

  // 11. Routing negative, direction one: the Meta fixture must not route to
  // X. Checked against the real Meta fixture archive.
  {
    const metaZipPath = path.join(__dirname, '..', 'fixtures', 'meta', 'meta-export.zip');
    assert.ok(fs.existsSync(metaZipPath), 'Meta fixture missing — run: node fixtures/meta/build-fixture.js');
    const metaBuf = fs.readFileSync(metaZipPath);
    const metaZip = await JSZip.loadAsync(metaBuf);
    const metaNames = Object.keys(metaZip.files).filter((n) => !metaZip.files[n].dir);
    assert.strictEqual(await XParser.isXExport(metaZip, metaNames), false, 'the Meta fixture archive must not be routed to the X parser');
  }

  // 12. Routing negative, direction two: the Google fixture must not route
  // to X.
  {
    const googleZipPath = path.join(__dirname, '..', 'fixtures', 'google', 'google-export.zip');
    assert.ok(fs.existsSync(googleZipPath), 'Google fixture missing — run: node fixtures/google/build-fixture.js');
    const googleBuf = fs.readFileSync(googleZipPath);
    const googleZip = await JSZip.loadAsync(googleBuf);
    const googleNames = Object.keys(googleZip.files).filter((n) => !googleZip.files[n].dir);
    assert.strictEqual(await XParser.isXExport(googleZip, googleNames), false, 'the Google fixture archive must not be routed to the X parser');
  }

  // 13. Routing negative, the other way: the X fixture must not route to
  // Meta or Google.
  assert.strictEqual(MetaParser.isMetaExport(names), false, 'the X fixture archive must not be routed to the Meta parser');
  assert.strictEqual(GoogleParser.isGoogleExport(names), false, 'the X fixture archive must not be routed to the Google parser');
  console.log('  + routing: the Meta and Google fixtures do not route to X, and the X fixture does not route to Meta or Google');

  // 14. Size caps, checked before inflation — a per-file cap. Same technique
  // as google.test.js: override the declared size JSZip populates from the
  // zip's central directory, and spy on .async() to prove the oversized
  // entry is never inflated.
  {
    const capZip = new JSZip();
    capZip.file('data/tweets.js', 'window.YTD.tweets.part0 = ' + JSON.stringify([{ tweet: { created_at: 'Tue Mar 01 10:15:00 +0000 2019' } }]) + ';');
    capZip.file('data/like.js', 'window.YTD.like.part0 = ' + JSON.stringify([{ like: {} }]) + ';');
    const buf2 = await capZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf2);

    const oversizedEntry = loaded.files['data/like.js'];
    oversizedEntry._data.uncompressedSize = XParser.SIZE_CAPS.PER_FILE_BYTES + 1024;
    let oversizedAsyncCalls = 0;
    const realAsync = oversizedEntry.async.bind(oversizedEntry);
    oversizedEntry.async = function (...args) {
      oversizedAsyncCalls++;
      return realAsync(...args);
    };

    const capResult = await XParser.parseArchive(loaded);
    assert.strictEqual(oversizedAsyncCalls, 0, 'entry above the per-file cap must never be inflated');
    assert.strictEqual(capResult.filesScanned, 1, 'only the small, real entry should have been scanned');
    assert.strictEqual(capResult.skipped.length, 1, 'expected one entry recorded as skipped');
    assert.strictEqual(capResult.skipped[0].name, 'data/like.js');
    assert.strictEqual(capResult.skipped[0].bytes, XParser.SIZE_CAPS.PER_FILE_BYTES + 1024);
  }

  // 15. Size caps — a total cap. Twelve small, real tweets.js-shaped
  // entries; declared sizes overridden so eleven fit under the 500 MB total
  // cap (11 x 45 MB = 495 MB) and the twelfth pushes it over.
  {
    const totalZip = new JSZip();
    const names2 = [];
    for (let i = 0; i < 12; i++) {
      const name = `data/tweets-part-${String(i).padStart(2, '0')}.js`;
      // Not a real X filename, but still matches the data/*.js path shape
      // parseArchive() enumerates — same as the real archive's own
      // multi-part naming when a file is split.
      names2.push(name);
      totalZip.file(name, 'window.YTD.tweets.part' + i + ' = ' + JSON.stringify([{ tweet: { created_at: 'Tue Mar 01 10:15:00 +0000 2019' } }]) + ';');
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
      await XParser.parseArchive(loaded);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'expected parseArchive() to reject once the total cap is crossed');
    assert.strictEqual(threw.code, 'SIZE_CAP_EXCEEDED', 'expected the SIZE_CAP_EXCEEDED error code');
    for (let i = 0; i < 11; i++) assert.strictEqual(asyncCalls[names2[i]], 1, `${names2[i]} should have been inflated`);
    assert.strictEqual(asyncCalls[names2[11]], 0, `${names2[11]} should never have been inflated`);
  }
  console.log('  + per-file size cap: oversized entry refused, never inflated');
  console.log('  + total size cap: stopped mid-archive, refused entry never inflated');

  // 16. Out-of-scope content — the archive's own root HTML and assets/
  // files — must never be opened, even though they exist in the fixture.
  {
    let calls = 0;
    const outOfScope = names.filter((n) => !XParser._internal.looksRelevantByPath(n));
    assert.ok(outOfScope.length >= 2, 'expected at least the two decoy non-data files to be out of scope');
    outOfScope.forEach((n) => {
      const entry = zip.files[n];
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        calls++;
        return realAsync(...args);
      };
    });
    await XParser.parseArchive(zip);
    assert.strictEqual(calls, 0, `expected zero out-of-scope files inflated, got ${calls}`);
  }
  console.log('  + out-of-scope files (archive root HTML, assets/): never inflated');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
