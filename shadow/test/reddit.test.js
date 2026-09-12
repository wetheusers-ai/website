/* Falsifiability test for website/shadow/parsers/reddit.js.
 *
 * Loads the synthetic fixture at fixtures/reddit/reddit-export.zip (rebuild
 * it with `node fixtures/reddit/build-fixture.js` if fixture-data.js
 * changes) and asserts the parser's counts against fixture-data.js's
 * EXPECTED block. Also asserts the routing negative in both directions
 * against the Meta and Google fixtures, size-cap behavior before
 * inflation, and malformed-record tolerance.
 *
 * No test framework — Node's built-in assert is enough for one file. Run:
 *   node website/shadow/test/reddit.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const RedditParser = require('../parsers/reddit.js');
const RedditFindings = require('../parsers/reddit.findings.js');
const MetaParser = require('../parsers/meta.js');
const GoogleParser = require('../parsers/google.js');
const D = require('../fixtures/reddit/fixture-data.js');

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'reddit', 'reddit-export.zip');
  assert.ok(fs.existsSync(zipPath), 'fixture missing — run: node fixtures/reddit/build-fixture.js');

  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // 1. isRedditExport() must recognize this archive from its own known CSV
  // basenames.
  assert.strictEqual(RedditParser.isRedditExport(names), true, 'isRedditExport() should detect the fixture archive');

  // A decoy file list with none of Reddit's known basenames must not fire.
  assert.strictEqual(
    RedditParser.isRedditExport(['random/export.json', 'random/products.csv']),
    false,
    'isRedditExport() should not fire on an unrelated file list'
  );

  // A single, generic-sounding basename alone (posts.csv, with nothing else
  // Reddit-specific alongside it) must not be enough on its own — this is
  // the multi-signal discipline documented in parsers/reddit.js.
  assert.strictEqual(
    RedditParser.isRedditExport(['some/other/export/posts.csv']),
    false,
    'a single generic basename (posts.csv alone) should not be enough to trust an archive as Reddit\'s'
  );

  // A single Reddit-specific basename IS enough on its own.
  assert.strictEqual(
    RedditParser.isRedditExport(['weird/nesting/subscribed_subreddits.csv']),
    true,
    'a single Reddit-specific basename (subscribed_subreddits.csv) should be enough on its own'
  );

  const r = await RedditParser.parseArchive(zip);

  // 2. Posts / comments — counts, malformed-record tolerance.
  assert.strictEqual(r.postCount, D.EXPECTED.postCount, `expected ${D.EXPECTED.postCount} posts, got ${r.postCount}`);
  assert.strictEqual(r.commentCount, D.EXPECTED.commentCount, `expected ${D.EXPECTED.commentCount} comments, got ${r.commentCount}`);

  // 3. The subreddit set — pooled and deduplicated across posts, comments,
  // and subscribed_subreddits.csv.
  assert.strictEqual(r.subreddits.length, D.EXPECTED.subredditCount, `expected ${D.EXPECTED.subredditCount} subreddits, got ${r.subreddits.length}`);
  D.EXPECTED.subreddits.forEach((s) => assert.ok(r.subreddits.includes(s), `missing subreddit: ${s}`));

  // 4. Votes — direction counted, no date (Reddit's own export carries none
  // on these two files).
  assert.deepStrictEqual(r.postVotes, D.EXPECTED.postVotes, `post_votes mismatch: ${JSON.stringify(r.postVotes)}`);
  assert.deepStrictEqual(r.commentVotes, D.EXPECTED.commentVotes, `comment_votes mismatch: ${JSON.stringify(r.commentVotes)}`);

  // 5. Messages — counts only.
  assert.strictEqual(r.messageCount, D.EXPECTED.messageCount, `expected ${D.EXPECTED.messageCount} messages, got ${r.messageCount}`);

  // 6. Saved items.
  assert.strictEqual(r.savedPostCount, D.EXPECTED.savedPostCount);
  assert.strictEqual(r.savedCommentCount, D.EXPECTED.savedCommentCount);

  // 7. The timestamp span — pooled across posts, comments, and messages.
  assert.ok(r.span, 'expected a timestamp span to be computed');
  const expectMin = RedditParser._internal.toSecondsFromDateString(D.EXPECTED.spanMinIso);
  const expectMax = RedditParser._internal.toSecondsFromDateString(D.EXPECTED.spanMaxIso);
  assert.strictEqual(r.span.min, expectMin, `expected span.min ${expectMin}, got ${r.span.min}`);
  assert.strictEqual(r.span.max, expectMax, `expected span.max ${expectMax}, got ${r.span.max}`);

  // 8. Files scanned/matched — only the eight relevant-shaped files;
  // birthdate.csv and gold_received.csv are never opened at all (checked
  // directly below), even though they are Reddit-named.
  assert.strictEqual(r.filesScanned, D.EXPECTED.filesScanned, `expected ${D.EXPECTED.filesScanned} files scanned, got ${r.filesScanned}`);
  assert.strictEqual(r.filesMatched, D.EXPECTED.filesMatched, `expected ${D.EXPECTED.filesMatched} files matched, got ${r.filesMatched}`);

  // 9. Malformed-record tolerance: one bad date in posts.csv, one bad
  // direction in post_votes.csv, one blank row in subscribed_subreddits.csv
  // — each counted, none voided the file it was in (postCount/postVotes/
  // subreddits above already prove the good rows around each one were
  // still read).
  assert.strictEqual(r.skippedRecords, D.EXPECTED.skippedRecords, `expected ${D.EXPECTED.skippedRecords} skipped records, got ${r.skippedRecords}`);

  console.log('PASS — reddit.js parser:');
  console.log(`  posts: ${r.postCount}, comments: ${r.commentCount}`);
  console.log(`  subreddits: ${r.subreddits.length} (${r.subreddits.join(', ')})`);
  console.log(`  post votes: ${JSON.stringify(r.postVotes)}, comment votes: ${JSON.stringify(r.commentVotes)}`);
  console.log(`  messages: ${r.messageCount} (counts only)`);
  console.log(`  saved: ${r.savedPostCount} posts, ${r.savedCommentCount} comments`);
  console.log(`  span: ${new Date(r.span.min * 1000).toISOString()} .. ${new Date(r.span.max * 1000).toISOString()}`);
  console.log(`  files scanned: ${r.filesScanned}, matched: ${r.filesMatched}, skipped records: ${r.skippedRecords}`);

  // 10. Routing negative, direction one: the Meta fixture must not route to
  // Reddit.
  {
    const metaZipPath = path.join(__dirname, '..', 'fixtures', 'meta', 'meta-export.zip');
    assert.ok(fs.existsSync(metaZipPath), 'Meta fixture missing — run: node fixtures/meta/build-fixture.js');
    const metaBuf = fs.readFileSync(metaZipPath);
    const metaZip = await JSZip.loadAsync(metaBuf);
    const metaNames = Object.keys(metaZip.files).filter((n) => !metaZip.files[n].dir);
    assert.strictEqual(RedditParser.isRedditExport(metaNames), false, 'the Meta fixture archive must not be routed to the Reddit parser');
  }

  // 11. Routing negative, direction two: the Google fixture must not route
  // to Reddit.
  {
    const googleZipPath = path.join(__dirname, '..', 'fixtures', 'google', 'google-export.zip');
    assert.ok(fs.existsSync(googleZipPath), 'Google fixture missing — run: node fixtures/google/build-fixture.js');
    const googleBuf = fs.readFileSync(googleZipPath);
    const googleZip = await JSZip.loadAsync(googleBuf);
    const googleNames = Object.keys(googleZip.files).filter((n) => !googleZip.files[n].dir);
    assert.strictEqual(RedditParser.isRedditExport(googleNames), false, 'the Google fixture archive must not be routed to the Reddit parser');
  }

  // 12. Routing negative, the other way: the Reddit fixture must not route
  // to Meta or Google.
  assert.strictEqual(MetaParser.isMetaExport(names), false, 'the Reddit fixture archive must not be routed to the Meta parser');
  assert.strictEqual(GoogleParser.isGoogleExport(names), false, 'the Reddit fixture archive must not be routed to the Google parser');
  console.log('  + routing: the Meta and Google fixtures do not route to Reddit, and the Reddit fixture does not route to Meta or Google');

  // 13. Size caps, checked before inflation — a per-file cap. Same
  // technique as the other parsers' tests: override the declared size
  // JSZip populates from the zip's central directory, and spy on .async()
  // to prove the oversized entry is never inflated.
  {
    const capZip = new JSZip();
    capZip.file('posts.csv', 'id,permalink,date,subreddit\np1,/r/x/p1,2021-01-01T00:00:00.000Z,FictionalSubA\n');
    capZip.file('comments.csv', 'id,permalink,date,subreddit\nc1,/r/x/c1,2021-01-01T00:00:00.000Z,FictionalSubA\n');
    const buf2 = await capZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf2);

    const oversizedEntry = loaded.files['comments.csv'];
    oversizedEntry._data.uncompressedSize = RedditParser.SIZE_CAPS.PER_FILE_BYTES + 1024;
    let oversizedAsyncCalls = 0;
    const realAsync = oversizedEntry.async.bind(oversizedEntry);
    oversizedEntry.async = function (...args) {
      oversizedAsyncCalls++;
      return realAsync(...args);
    };

    const capResult = await RedditParser.parseArchive(loaded);
    assert.strictEqual(oversizedAsyncCalls, 0, 'entry above the per-file cap must never be inflated');
    assert.strictEqual(capResult.filesScanned, 1, 'only the small, real entry should have been scanned');
    assert.strictEqual(capResult.skipped.length, 1, 'expected one entry recorded as skipped');
    assert.strictEqual(capResult.skipped[0].name, 'comments.csv');
    assert.strictEqual(capResult.skipped[0].bytes, RedditParser.SIZE_CAPS.PER_FILE_BYTES + 1024);
  }

  // 14. Size caps — a total cap. Reddit's export has only 8 distinct
  // basenames this parser reads (a zip cannot hold two entries with the
  // same name), and 8 files at up to the 50 MB per-file cap tops out at
  // 400 MB — never enough on its own to cross the 500 MB total cap. So
  // this test temporarily lowers TOTAL_BYTES to something 8 small files
  // CAN cross, asserts the cap fires at the right entry, then restores the
  // real value in a `finally` before anything else in this file could
  // observe the smaller one.
  {
    const totalZip = new JSZip();
    const distinctBasenames = ['posts.csv', 'comments.csv', 'post_votes.csv', 'comment_votes.csv', 'messages.csv', 'subscribed_subreddits.csv', 'saved_posts.csv', 'saved_comments.csv'];
    distinctBasenames.forEach((name) => {
      totalZip.file(name, name === 'post_votes.csv' || name === 'comment_votes.csv'
        ? 'id,permalink,direction\nx1,/r/x,up\n'
        : name === 'subscribed_subreddits.csv'
        ? 'subreddit\nFictionalSubA\n'
        : name === 'saved_posts.csv' || name === 'saved_comments.csv'
        ? 'id,permalink\nx1,/r/x\n'
        : 'id,permalink,date,subreddit\nx1,/r/x,2021-01-01T00:00:00.000Z,FictionalSubA\n');
    });

    const buf3 = await totalZip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf3);

    const TEN_MB = 10 * 1024 * 1024; // 8 x 10 MB = 80 MB — well under the real 500 MB cap...
    const originalTotalCap = RedditParser.SIZE_CAPS.TOTAL_BYTES;
    RedditParser.SIZE_CAPS.TOTAL_BYTES = 35 * 1024 * 1024; // ...but over this temporary 35 MB one, partway through.
    const asyncCalls = {};
    distinctBasenames.forEach((name) => {
      const entry = loaded.files[name];
      entry._data.uncompressedSize = TEN_MB;
      asyncCalls[name] = 0;
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        asyncCalls[name]++;
        return realAsync(...args);
      };
    });

    let threw = null;
    try {
      await RedditParser.parseArchive(loaded);
    } catch (e) {
      threw = e;
    } finally {
      RedditParser.SIZE_CAPS.TOTAL_BYTES = originalTotalCap;
    }
    assert.ok(threw, 'expected parseArchive() to reject once the (temporarily lowered) total cap is crossed');
    assert.strictEqual(threw.code, 'SIZE_CAP_EXCEEDED', 'expected the SIZE_CAP_EXCEEDED error code');
    // 35 MB / 10 MB = 3.5 — the first 3 entries fit (30 MB), the 4th pushes
    // the running total to 40 MB and is refused before inflation.
    for (let i = 0; i < 3; i++) assert.strictEqual(asyncCalls[distinctBasenames[i]], 1, `${distinctBasenames[i]} should have been inflated`);
    assert.strictEqual(asyncCalls[distinctBasenames[3]], 0, `${distinctBasenames[3]} should never have been inflated`);
    assert.strictEqual(RedditParser.SIZE_CAPS.TOTAL_BYTES, originalTotalCap, 'the real TOTAL_BYTES cap must be restored after this test');
  }
  console.log('  + per-file size cap: oversized entry refused, never inflated');
  console.log('  + total size cap: stopped mid-archive, refused entry never inflated');

  // 15. Out-of-scope content — birthdate.csv, gold_received.csv, and the
  // unrelated notes/random.csv — must never be opened, even though the
  // first two are Reddit-named and recognized by isRedditExport().
  {
    let calls = 0;
    const outOfScope = names.filter((n) => !RedditParser._internal.looksRelevantByPath(n));
    assert.ok(outOfScope.length >= 3, 'expected at least the three decoy files to be out of scope');
    outOfScope.forEach((n) => {
      const entry = zip.files[n];
      const realAsync = entry.async.bind(entry);
      entry.async = function (...args) {
        calls++;
        return realAsync(...args);
      };
    });
    await RedditParser.parseArchive(zip);
    assert.strictEqual(calls, 0, `expected zero out-of-scope files inflated, got ${calls}`);
  }
  console.log('  + out-of-scope files (birthdate.csv, gold_received.csv, unrelated CSV): never inflated');

  // 16. The CSV parser's own quote handling: posts.csv row 1 carries a
  // quoted field with both an embedded comma and an embedded newline. If
  // that were mishandled, either the row count or the recovered subreddit/
  // date for THAT row would be wrong — both are checked directly here via
  // parseFromEntries() on a minimal, isolated entry.
  {
    const quoted = RedditParser.parseFromEntries([{ name: 'posts.csv', text: D.postsCsv }]);
    assert.strictEqual(quoted.postCount, D.EXPECTED.postCount, 'quoted multi-line field must not corrupt row counting');
    assert.ok(quoted.subreddits.includes('FictionalSubA'), 'the quoted row\'s own subreddit must still be recovered correctly');
  }
  console.log('  + CSV quoting: an embedded comma and an embedded newline inside a quoted field do not corrupt row counting');

  // 17. The span must come from posts and comments only. Twenty posts,
  // all dated within 2024 (an eight-month true span), plus one private
  // message dated 2008 — years before any of them — must NOT stretch
  // "The span" out to 16+ years. Before this fix, messages.csv's date was
  // pooled into the same timestamp list posts and comments used, so the
  // one old message alone set the headline number.
  {
    const header = 'id,permalink,date,subreddit,title,url,body\n';
    let twentyPostsCsv = header;
    for (let i = 0; i < 20; i++) {
      const month = String((i % 8) + 1).padStart(2, '0'); // Jan..Aug 2024
      twentyPostsCsv += `p${i},/r/FictionalSubA/comments/p${i},2024-${month}-01T00:00:00.000Z,FictionalSubA,title ${i},https://example.invalid/p${i},body ${i}\n`;
    }
    const oldMessageCsv =
      'id,permalink,date,from,to,subject,body\n' +
      'm1,/message/messages/m1,2008-01-01T00:00:00.000Z,fictitious_sender,fixture_owner,old subject,old body\n';

    const r2 = RedditParser.parseFromEntries([
      { name: 'posts.csv', text: twentyPostsCsv },
      { name: 'messages.csv', text: oldMessageCsv },
    ]);
    assert.strictEqual(r2.postCount, 20, `expected 20 posts, got ${r2.postCount}`);
    assert.strictEqual(r2.messageCount, 1, `expected 1 message, got ${r2.messageCount}`);
    assert.ok(r2.span, 'expected a span to be computed from the posts alone');

    const expectMin2 = RedditParser._internal.toSecondsFromDateString('2024-01-01T00:00:00.000Z');
    const expectMax2 = RedditParser._internal.toSecondsFromDateString('2024-08-01T00:00:00.000Z');
    assert.strictEqual(r2.span.min, expectMin2, `expected span.min to be the earliest POST date, got ${new Date(r2.span.min * 1000).toISOString()}`);
    assert.strictEqual(r2.span.max, expectMax2, `expected span.max to be the latest POST date, got ${new Date(r2.span.max * 1000).toISOString()}`);

    // Confirmed on the actual headline "The span" prints, not just on the
    // raw span object: a span this short (under a year) must read in
    // months/days-scale terms, never "16.x years" — the number the 2008
    // message alone would have produced under the old, unfixed code.
    const spanCard = RedditFindings.buildFindings(r2).find((f) => f.v === 'The span');
    assert.ok(spanCard, 'expected a "The span" card from 20 posts');
    assert.ok(!/1[0-9]\.\d years/.test(spanCard.h), `expected no double-digit-year span headline from a message years outside the post range, got: ${spanCard.h}`);
    assert.ok(spanCard.h.includes('20 posts and comments'), `expected the headline to state 20 posts and comments, got: ${spanCard.h}`);
  }
  console.log('  + span: 20 posts across 2024 plus one message from 2008 yields the posts-and-comments span, not the message-stretched one');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
