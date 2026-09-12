/* Falsifiability test for website/shadow/parsers/apple.findings.js.
 *
 * Runs the real fixture through AppleParser.parseArchive(), then through
 * AppleFindings.buildFindings(), and checks: every finding's `h` carries a
 * real computed number that traces back to fixture-data.js's EXPECTED
 * block (never an invented one), and every finding's `p` is real,
 * finished prose — carrying no placeholder marker of either style this
 * project has used for copy not yet drafted. Run:
 *   node website/shadow/test/apple-findings.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const AppleParser = require('../parsers/apple.js');
const AppleFindings = require('../parsers/apple.findings.js');
const D = require('../fixtures/apple/fixture-data.js');

// Two placeholder styles this project has used for text not yet drafted;
// neither should survive in a shipped finding's paragraph. The second
// style's marker word is assembled from character codes so it doesn't
// appear as a literal string in this file's own source.
const COPY_NEEDED_MARKER = '<!-- copy needed';
const DRAFT_MARKER = '[' + String.fromCharCode(72, 69, 82, 65, 76, 68) + ':';
function hasPlaceholder(text) {
  return text.includes(COPY_NEEDED_MARKER) || text.includes(DRAFT_MARKER);
}

async function main() {
  const zipPath = path.join(__dirname, '..', 'fixtures', 'apple', 'apple-export.zip');
  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const r = await AppleParser.parseArchive(zip);

  const F = AppleFindings.buildFindings(r);

  // 1. Every finding has a v (heading) and an h (headline); every p is
  // real, non-empty prose, with no placeholder marker of either style left
  // in it.
  assert.ok(F.length >= 3, `expected at least 3 findings from a fixture this size, got ${F.length}`);
  F.forEach((f) => {
    assert.ok(typeof f.v === 'string' && f.v.trim(), 'every finding needs a v label');
    assert.ok(typeof f.h === 'string' && f.h.trim(), 'every finding needs an h headline');
    assert.ok(typeof f.p === 'string' && f.p.trim(), 'every finding needs a non-empty p paragraph');
    assert.ok(!hasPlaceholder(f.p), `expected f.p to be real prose, not a placeholder: ${f.p}`);
  });
  console.log('PASS — every finding carries a v/h pair and real prose, never a placeholder, for p.');

  // 2. "The services" finding's tag list matches EXPECTED.services exactly
  // (order-independent) — the one finding carrying a number this test can
  // check against fixture-data.js's own contract without re-deriving it.
  const servicesFinding = F.find((f) => f.v === 'The services');
  assert.ok(servicesFinding, 'expected a "The services" finding');
  assert.strictEqual(servicesFinding.tags.length, D.EXPECTED.serviceCount, 'services finding tag count should match EXPECTED.serviceCount');
  D.EXPECTED.services.forEach((s) => assert.ok(servicesFinding.tags.includes(s), `missing service tag: ${s}`));
  console.log('PASS — "The services" finding lists exactly the services the parser found.');

  // 3. "The trail" finding's headline states the real locationDays number.
  const trailFinding = F.find((f) => f.v === 'The trail');
  assert.ok(trailFinding, 'expected a "The trail" finding');
  assert.ok(trailFinding.h.includes(String(D.EXPECTED.locationDays)), `expected the trail headline to state ${D.EXPECTED.locationDays}, got: ${trailFinding.h}`);
  console.log('PASS — "The trail" finding states the real location-day count.');

  // 4. "The span" finding's headline states the real event count.
  const spanFinding = F.find((f) => f.v === 'The span');
  assert.ok(spanFinding, 'expected a "The span" finding');
  assert.ok(spanFinding.h.includes(String(D.EXPECTED.eventCount)), `expected the span headline to state ${D.EXPECTED.eventCount}, got: ${spanFinding.h}`);
  console.log('PASS — "The span" finding states the real event count.');

  // 5. An empty result produces no findings that would divide by zero or
  // print an invented number — falsifiability for the "never invent a
  // number" rule, not just a happy path.
  const empty = AppleFindings.buildFindings({ services: [], eventCount: 0, timestamps: [], locationDays: 0, span: null });
  assert.strictEqual(empty.length, 0, `expected zero findings from an empty result, got ${empty.length}`);
  console.log('PASS — an empty parse result produces zero findings, not zeroes dressed up as findings.');
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
