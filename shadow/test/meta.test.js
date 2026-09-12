/* Falsifiability test for website/shadow/parsers/meta.js.
 *
 * Loads the synthetic fixture at fixtures/meta/meta-export.zip (rebuild it
 * with `node fixtures/meta/build-fixture.js` if fixture-data.js changes)
 * and asserts the parser's counts against fixture-data.js's EXPECTED block.
 *
 * No test framework — Node's built-in assert is enough for one file. Run:
 *   node website/shadow/test/meta.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const MetaParser = require('../parsers/meta.js');
const D = require('../fixtures/meta/fixture-data.js');

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'meta', 'meta-export.zip');
  assert.ok(fs.existsSync(zipPath), `fixture missing — run: node fixtures/meta/build-fixture.js`);

  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // 1. isMetaExport() must recognize this archive from its path hints.
  assert.strictEqual(MetaParser.isMetaExport(names), true, 'isMetaExport() should detect the fixture archive');

  // A decoy archive with none of the Meta hints must not be misdetected.
  assert.strictEqual(
    MetaParser.isMetaExport(['random/export.json', 'random/products.json']),
    false,
    'isMetaExport() should not fire on an unrelated file list'
  );

  const r = await MetaParser.parseArchive(zip);

  // 2. Advertisers — deduplicated across two files, two eras of path/shape.
  assert.strictEqual(
    r.advertisers.length,
    D.EXPECTED.advertiserCount,
    `expected ${D.EXPECTED.advertiserCount} unique advertisers, got ${r.advertisers.length}`
  );
  D.uniqueAdvertisers.forEach((name) => {
    assert.ok(r.advertisers.includes(name), `missing advertiser: ${name}`);
  });
  // The shape-only file (no path hint) must have contributed — proves
  // detection isn't relying on the path.
  D.advertisersFileB.forEach((name) => {
    assert.ok(r.advertisers.includes(name), `advertiser from the unhinted path/shape-only file missing: ${name}`);
  });

  // 3. Threads — three conversations; one split across two chunk files must
  // still count as one.
  assert.strictEqual(
    r.threads.length,
    D.EXPECTED.threadCount,
    `expected ${D.EXPECTED.threadCount} threads, got ${r.threads.length}`
  );
  const totalMessages = r.threads.reduce((s, t) => s + t.messageCount, 0);
  assert.strictEqual(
    totalMessages,
    D.EXPECTED.threadMessageTotal,
    `expected ${D.EXPECTED.threadMessageTotal} total messages across threads, got ${totalMessages}`
  );
  const merged = r.threads.find((t) => t.files.length > 1);
  assert.ok(merged, 'expected one thread to be merged from multiple chunk files (message_1.json + message_2.json)');
  assert.strictEqual(merged.messageCount, 3, 'merged thread should sum messages across its chunk files');

  // 4. Posts and ads_and_topics counted.
  assert.strictEqual(r.posts, D.EXPECTED.postsCount, `expected ${D.EXPECTED.postsCount} posts, got ${r.posts}`);
  assert.strictEqual(
    r.adsAndTopicsEvents,
    D.EXPECTED.adsAndTopicsEventsCount,
    `expected ${D.EXPECTED.adsAndTopicsEventsCount} ads_and_topics events, got ${r.adsAndTopicsEvents}`
  );
  assert.strictEqual(r.topics.length, D.EXPECTED.topicsCount, `expected ${D.EXPECTED.topicsCount} topics, got ${r.topics.length}`);

  // 5. The timestamp span — pooled across threads, posts, and ads_and_topics.
  assert.ok(r.span, 'expected a timestamp span to be computed');
  const expectMin = D.iso(D.EXPECTED.spanMinIso);
  const expectMax = D.iso(D.EXPECTED.spanMaxIso);
  assert.strictEqual(r.span.min, expectMin, `expected span.min ${expectMin} (${D.EXPECTED.spanMinIso}), got ${r.span.min}`);
  assert.strictEqual(r.span.max, expectMax, `expected span.max ${expectMax} (${D.EXPECTED.spanMaxIso}), got ${r.span.max}`);

  // 6. Decoy files must not leak into any count.
  assert.strictEqual(r.advertisers.includes('A1'), false);
  assert.ok(!r.advertisers.some((a) => /sku/i.test(a)));

  // 7. Regression: 200,000 timestamps must not throw. The failure mode is
  // `Math.min(...arr)`/`Math.max(...arr)` — spreading an array into a call
  // is bounded by V8's argument-count limit (measured: fine at 124,000,
  // RangeError at 125,000). Reproduces that shape — a single ads_and_topics
  // file, one array-valued key, one row per impression — at above that
  // threshold, called directly through parseFromEntries so the case is
  // fast and needs no zip I/O.
  {
    const big = [];
    const base = Date.parse('2015-01-01T00:00:00Z') / 1000;
    for (let i = 0; i < 200000; i++) {
      big.push({ timestamp: base + i }); // 200,000 distinct, plausible seconds
    }
    const text = JSON.stringify({ impressions_history_posts_seen: big });
    let out;
    assert.doesNotThrow(() => {
      out = MetaParser.parseFromEntries([
        { name: 'ads_information/ads_and_topics/posts_viewed.json', text },
      ]);
    }, 'parseFromEntries must not throw on 200,000 timestamps (RangeError regression)');
    assert.strictEqual(out.adsAndTopicsEvents, 200000, 'expected all 200,000 rows counted');
    assert.ok(out.span, 'expected a span to be computed for 200,000 timestamps');
    assert.strictEqual(out.span.min, base, 'span.min should be the earliest of the 200,000 timestamps');
    assert.strictEqual(out.span.max, base + 199999, 'span.max should be the latest of the 200,000 timestamps');
  }

  // 8. Size caps, checked before inflation — a per-file cap.
  // Builds a zip with a few small, real entries, then overrides the
  // internal field JSZip itself populates from the zip's central directory
  // (`entry._data.uncompressedSize`) to simulate one entry whose *declared*
  // size lies above the per-file cap — exactly what a crafted archive's
  // central directory would produce when JSZip parses it, without needing
  // to hand-assemble raw zip bytes to prove the same code path. A spy on
  // `.async()` proves the oversized entry is never inflated; only its
  // declared size is read.
  {
    const capZip = new JSZip();
    capZip.file('ads_information/small_real.json', JSON.stringify({ ok: true }));
    capZip.file('ads_information/oversized_by_declared_size.json', JSON.stringify({ ok: true }));
    const buf = await capZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf);

    const oversizedEntry = loaded.files['ads_information/oversized_by_declared_size.json'];
    oversizedEntry._data.uncompressedSize = MetaParser.SIZE_CAPS.PER_FILE_BYTES + 1024;
    let oversizedAsyncCalls = 0;
    const realAsync = oversizedEntry.async.bind(oversizedEntry);
    oversizedEntry.async = function (...args) {
      oversizedAsyncCalls++;
      return realAsync(...args);
    };

    const capResult = await MetaParser.parseArchive(loaded);
    assert.strictEqual(oversizedAsyncCalls, 0, 'entry above the per-file cap must never be inflated');
    assert.strictEqual(capResult.filesScanned, 1, 'only the small, real entry should have been scanned');
  }

  // 9. Size caps — a total cap. Twelve small, real entries; declared sizes
  // overridden the same way as case 8 so eleven of them fit under the
  // 500 MB total cap (11 × 45 MB = 495 MB) and the twelfth pushes the
  // running total over it (540 MB). Asserts the archive read stops there:
  // the twelfth (and only the twelfth) is never inflated, and
  // parseArchive() rejects with the SIZE_CAP_EXCEEDED error rather than
  // silently truncating or blaming the file as unreadable.
  {
    const totalZip = new JSZip();
    const names = [];
    for (let i = 0; i < 12; i++) {
      const name = `ads_information/chunk_${String(i).padStart(2, '0')}.json`;
      names.push(name);
      totalZip.file(name, JSON.stringify({ i }));
    }
    const buf = await totalZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf);

    const FORTY_FIVE_MB = 45 * 1024 * 1024;
    const asyncCalls = {};
    names.forEach((name) => {
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
      await MetaParser.parseArchive(loaded);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'expected parseArchive() to reject once the total cap is crossed');
    assert.strictEqual(threw.code, 'SIZE_CAP_EXCEEDED', 'expected the SIZE_CAP_EXCEEDED error code');
    // 495 MB across the first eleven stays under the 500 MB cap; the
    // twelfth (11 × 45 = 495, +45 = 540) is the one that crosses it.
    for (let i = 0; i < 11; i++) assert.strictEqual(asyncCalls[names[i]], 1, `${names[i]} should have been inflated`);
    assert.strictEqual(asyncCalls[names[11]], 0, `${names[11]} should never have been inflated`);
  }

  // 10. Routing — isMetaExport() must key off the export's own known shape,
  // never a bare substring match on "facebook"/"instagram" anywhere in a
  // path. A Google-Takeout-shaped file list that merely mentions Facebook
  // inside a saved-links export must not route to the Meta parser.
  {
    const takeoutNames = [
      'Takeout/archive_browser.html',
      'Takeout/Saved/facebook links.csv',
      'Takeout/Google Photos/IMG_0001.jpg',
      'Takeout/My Activity/Search/MyActivity.json',
    ];
    assert.strictEqual(
      MetaParser.isMetaExport(takeoutNames),
      false,
      'a Google Takeout export mentioning "facebook" in a filename must not be routed to the Meta parser'
    );
  }

  // 11. Regression: the account owner must be identified and excluded
  // from the friend ranking, and a large group thread must not
  // out-credit a real, two-person friendship. detectOwner() should find
  // "You Test Person" (present in all 4 fixture threads); friendScores()
  // should then rank a real friend on top, never the owner, with scores
  // matching hand-computed expectations (messageCount / other-participant
  // count, per thread, summed per person).
  {
    const owner = MetaParser.detectOwner(r.threads);
    assert.strictEqual(owner, D.OWNER, `expected detectOwner() to identify "${D.OWNER}", got "${owner}"`);

    const { owner: fsOwner, scores } = MetaParser.friendScores(r.threads);
    assert.strictEqual(fsOwner, D.OWNER, 'friendScores() should identify the same owner as detectOwner()');
    assert.ok(!(D.OWNER in scores), 'the account owner must not appear in the friend ranking at all');

    Object.keys(D.EXPECTED_FRIEND_SCORES).forEach((name) => {
      const expected = D.EXPECTED_FRIEND_SCORES[name];
      const got = scores[name];
      assert.ok(
        got !== undefined && Math.abs(got - expected) < 1e-9,
        `expected weighted score ${expected} for "${name}", got ${got}`
      );
    });

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    assert.strictEqual(
      ranked[0][0],
      D.EXPECTED_TOP_FRIEND,
      `expected top-ranked friend to be "${D.EXPECTED_TOP_FRIEND}" (a real friend, not the owner, and not diluted by the 40-person group), got "${ranked[0][0]}"`
    );
    assert.notStrictEqual(ranked[0][0], D.OWNER, 'the top-ranked friend must never be the account owner');
  }

  // 12. detectOwner() must refuse to guess below the three-thread floor —
  // two participants who happen to share both threads in a tiny export
  // should not be mistaken for an owner.
  {
    const tiny = [
      { participants: ['Alice', 'Bob'], messageCount: 5 },
      { participants: ['Alice', 'Bob'], messageCount: 3 },
    ];
    assert.strictEqual(MetaParser.detectOwner(tiny), null, 'detectOwner() should not report an owner from fewer than 3 threads');
  }

  console.log('PASS — meta.js parser:');
  console.log(`  advertisers: ${r.advertisers.length} (unique, across ${D.advertisersFileA.length + D.advertisersFileB.length} raw entries in 2 files at different paths/shapes)`);
  console.log(`  threads: ${r.threads.length} (from ${r.threads.reduce((s, t) => s + t.files.length, 0)} message chunk files)`);
  console.log(`  posts: ${r.posts}`);
  console.log(`  ads_and_topics events: ${r.adsAndTopicsEvents}, topics: ${r.topics.length}`);
  console.log(`  span: ${new Date(r.span.min * 1000).toISOString()} .. ${new Date(r.span.max * 1000).toISOString()}`);
  console.log(`  files scanned: ${r.filesScanned}, matched: ${r.filesMatched}`);
  console.log('  + 200,000-timestamp regression: no throw, span computed correctly');
  console.log('  + per-file size cap: oversized entry refused, never inflated');
  console.log('  + total size cap: stopped mid-archive, refused entry never inflated');
  console.log('  + routing: Google-Takeout "Saved/facebook links.csv" does not route to Meta');
  console.log('  + friend ranking: owner excluded, 40-person group weighted down, top friend is a real friend');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
