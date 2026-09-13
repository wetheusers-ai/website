/* Hygiene test: the published website/ tree must carry no internal
 * tracking residue from how the site is built (issue-tracker IDs, internal
 * role names, review-round notes, paths into the private working tree).
 * The pattern list is maintenance tooling and lives beside the private
 * working tree rather than in the published site. Filesystem-only, no
 * browser. If the private tree is absent (a clone that only took
 * website/), this SKIPS loudly rather than silently passing.
 *
 * Run with:
 *   node website/shadow/test/census.test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const PRIVATE_ROOT = path.join(ROOT, '..');

function findCensusModule() {
  // The private working tree, if present, is a sibling of website/.
  const dir = path.join(PRIVATE_ROOT, 'lab');
  if (!fs.existsSync(dir)) return null;
  const modulePath = path.join(dir, 'ops', 'publish-census.js');
  if (!fs.existsSync(modulePath)) return null;
  return modulePath;
}

function main() {
  const modulePath = findCensusModule();
  if (!modulePath) {
    console.log(
      'SKIP — private working directory not present in this checkout, so the whole-tree census has ' +
        'nothing to run. Not a failure: a checkout that only took website/ cannot carry this check.'
    );
    return;
  }
  const { census } = require(modulePath);
  const hits = census(ROOT);
  if (hits.length) {
    console.error(`FAIL — whole-tree census of ${ROOT} found ${hits.length} hit(s):`);
    for (const h of hits) {
      console.error(`  ${h.file}: ${h.pattern} — ${h.matches.join(', ')}`);
    }
    process.exit(1);
  }
  console.log(`PASS — whole-tree census of website/: no hits.`);
}

main();
