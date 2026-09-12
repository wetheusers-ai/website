/* Falsifiability test for the finished copy in parsers/apple.findings.js,
 * parsers/x.findings.js, and parsers/reddit.findings.js.
 *
 * apple.findings.js already has its own dedicated test (apple-findings.test.js)
 * for the parser-specific claims (service list, location-day count, event
 * count). This file is the one place all three modules are checked
 * together for two things: no placeholder text of either style this
 * project has used for copy not yet drafted reaches a finding's `p`, and
 * the three modules produce the same { v, h, p, tags? } shape.
 *
 * Run:
 *   node website/shadow/test/findings-copy.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');

const AppleParser = require('../parsers/apple.js');
const AppleFindings = require('../parsers/apple.findings.js');
const XParser = require('../parsers/x.js');
const XFindings = require('../parsers/x.findings.js');
const RedditParser = require('../parsers/reddit.js');
const RedditFindings = require('../parsers/reddit.findings.js');

// Two placeholder styles this project has used for text not yet drafted;
// neither should survive in a shipped finding's paragraph. The second
// style's marker word is assembled from character codes so it doesn't
// appear as a literal string in this file's own source.
const COPY_NEEDED_MARKER = '<!-- copy needed';
const DRAFT_MARKER = '[' + String.fromCharCode(72, 69, 82, 65, 76, 68) + ':';
function hasPlaceholder(text) {
  return text.includes(COPY_NEEDED_MARKER) || text.includes(DRAFT_MARKER);
}

async function loadZip(rel) {
  const zipPath = path.join(__dirname, '..', 'fixtures', rel);
  assert.ok(fs.existsSync(zipPath), `fixture missing: ${zipPath}`);
  return JSZip.loadAsync(fs.readFileSync(zipPath));
}

async function main() {
  const appleZip = await loadZip('apple/apple-export.zip');
  const xZip = await loadZip('x/x-export.zip');
  const redditZip = await loadZip('reddit/reddit-export.zip');

  const appleResult = await AppleParser.parseArchive(appleZip);
  const xResult = await XParser.parseArchive(xZip);
  const redditResult = await RedditParser.parseArchive(redditZip);

  const suites = [
    { name: 'apple', F: AppleFindings.buildFindings(appleResult) },
    { name: 'x', F: XFindings.buildFindings(xResult) },
    { name: 'reddit', F: RedditFindings.buildFindings(redditResult) },
  ];

  let totalFindings = 0;
  for (const { name, F } of suites) {
    assert.ok(F.length > 0, `expected at least one finding from the ${name} fixture`);
    F.forEach((f) => {
      assert.ok(typeof f.v === 'string' && f.v.trim(), `${name}: every finding needs a v label`);
      assert.ok(typeof f.h === 'string' && f.h.trim(), `${name}: every finding needs an h headline`);
      assert.ok(typeof f.p === 'string' && f.p.trim(), `${name}: every finding needs a non-empty p paragraph`);
      assert.ok(!hasPlaceholder(f.p), `${name}: finding "${f.v}" still carries a placeholder: ${f.p}`);
      if (f.tags !== undefined) assert.ok(Array.isArray(f.tags), `${name}: tags, where present, must be an array`);
    });
    totalFindings += F.length;
  }
  console.log(
    `PASS — ${totalFindings} findings across apple/x/reddit findings modules; every one carries real, ` +
      'non-placeholder prose in the same {v, h, p, tags?} shape.'
  );
}

main().catch((e) => {
  console.error('FAIL —', e.message);
  process.exit(1);
});
