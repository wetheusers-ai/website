/* Builds fixtures/reddit/reddit-export.zip — a synthetic, minimal stand-in
 * for a real Reddit data export. All names, subreddits, and usernames in
 * it are invented (see fixture-data.js). Run with:
 *
 *   node website/shadow/fixtures/reddit/build-fixture.js
 *
 * Lays out one CSV per shape parsers/reddit.js reads (posts, comments,
 * post_votes, comment_votes, messages, subscribed_subreddits, saved_posts,
 * saved_comments), at the archive root — the flat layout Reddit's own
 * export uses (no per-product folder tree) — plus two more Reddit-named
 * CSVs (birthdate.csv, gold_received.csv) that must be recognized as part
 * of a Reddit export but never opened, and one unrelated CSV that must
 * never affect detection either way.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();

zip.file('posts.csv', D.postsCsv);
zip.file('comments.csv', D.commentsCsv);
zip.file('post_votes.csv', D.postVotesCsv);
zip.file('comment_votes.csv', D.commentVotesCsv);
zip.file('messages.csv', D.messagesCsv);
zip.file('subscribed_subreddits.csv', D.subscribedSubredditsCsv);
zip.file('saved_posts.csv', D.savedPostsCsv);
zip.file('saved_comments.csv', D.savedCommentsCsv);

// -- recognized as Reddit, never opened for content --
zip.file('birthdate.csv', D.birthdateCsv);
zip.file('gold_received.csv', D.goldReceivedCsv);

// -- decoy: unrelated CSV, must not affect detection --
zip.file('notes/random.csv', D.decoyUnrelatedCsv);

zip
  .generateAsync({ type: 'nodebuffer' })
  .then((buf) => {
    const out = path.join(__dirname, 'reddit-export.zip');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
