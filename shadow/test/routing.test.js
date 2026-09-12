/* Falsifiability test for cross-parser routing.
 *
 * index.html's ingest() now tries five detectors in order — Meta, Google,
 * Apple, X, Reddit — before falling back to the generic path (see that
 * function's own comment). Each parser's own test file already checks that
 * parser's detector against the Meta and Google fixtures in both
 * directions; this file is the one place all C(5,2) = 10 fixture pairs,
 * checked in both directions (20 negative checks total), are asserted
 * together — including the three pairs no single parser's own test file
 * covers on its own: Apple/X, Apple/Reddit, and X/Reddit.
 *
 * Also asserts the positive case for all five: each fixture is recognized
 * by its own parser's detector, so a negative-only suite could not pass by
 * having every detector simply always return false.
 *
 * Run:
 *   node website/shadow/test/routing.test.js
 * (No playwright needed — this drives the detector functions directly,
 * the same as every other parsers/*.test.js file, not the page.)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const MetaParser = require('../parsers/meta.js');
const GoogleParser = require('../parsers/google.js');
const AppleParser = require('../parsers/apple.js');
const XParser = require('../parsers/x.js');
const RedditParser = require('../parsers/reddit.js');

// detect(zip, names) — every entry takes the same two-argument shape, even
// though only X's real detector reads `zip` (it peeks at file content —
// see x.js's own header on why a name-only check would be a guess for X).
// The other four ignore the first argument, so every fixture can be run
// through every detector with one identical call.
const PLATFORMS = [
  { key: 'meta', file: 'meta/meta-export.zip', detect: (zip, names) => MetaParser.isMetaExport(names) },
  { key: 'google', file: 'google/google-export.zip', detect: (zip, names) => GoogleParser.isGoogleExport(names) },
  { key: 'apple', file: 'apple/apple-export.zip', detect: (zip, names) => AppleParser.isAppleExport(names) },
  { key: 'x', file: 'x/x-export.zip', detect: (zip, names) => XParser.isXExport(zip, names) },
  { key: 'reddit', file: 'reddit/reddit-export.zip', detect: (zip, names) => RedditParser.isRedditExport(names) },
];

async function loadFixture(rel) {
  const zipPath = path.join(__dirname, '..', 'fixtures', rel);
  assert.ok(
    fs.existsSync(zipPath),
    `fixture missing: ${zipPath} — run: node fixtures/${rel.split('/')[0]}/build-fixture.js`
  );
  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  return { zip, names };
}

async function main() {
  const loaded = {};
  for (const p of PLATFORMS) loaded[p.key] = await loadFixture(p.file);

  // 1. Positive case — each fixture is recognized by its own parser.
  for (const p of PLATFORMS) {
    const { zip, names } = loaded[p.key];
    const ok = await p.detect(zip, names);
    assert.strictEqual(ok, true, `${p.key}'s own detector should recognize its own fixture`);
  }
  console.log('PASS — each of the five fixtures is recognized by its own parser.');

  // 2. Negative case — no OTHER platform's detector fires on it. Every
  // ordered pair (target fixture, other detector) with target !== other is
  // checked, which covers both directions of all ten unordered pairs —
  // including a Google Takeout fixture against the X and Reddit detectors,
  // and a Meta export against the Reddit detector, the two specific
  // failure modes this task named (a Takeout archive with an x-named file,
  // a Meta export with a reddit-named CSV) alongside every other
  // combination.
  let checks = 0;
  for (const target of PLATFORMS) {
    for (const other of PLATFORMS) {
      if (target.key === other.key) continue;
      const { zip, names } = loaded[target.key];
      const fired = await other.detect(zip, names);
      assert.strictEqual(
        fired,
        false,
        `${other.key}'s detector must NOT fire on the ${target.key} fixture (misroute)`
      );
      checks++;
    }
  }
  assert.strictEqual(checks, 20, `expected 20 cross-routing checks (5 platforms x 4 others), ran ${checks}`);
  console.log(`PASS — ${checks} cross-routing negatives: none of the five fixtures is misrouted to another platform's parser.`);
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
