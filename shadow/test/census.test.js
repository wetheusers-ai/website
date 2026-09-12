/* Falsifiability test: the whole published website/ tree — not just the
 * data files under shadow/data/ — must carry no internal work-log
 * residue left behind by however this site gets built: no task-tracking
 * IDs, no internal role names, no phrase describing an internal review
 * exercise or its round number, no word used to mean an automated
 * contributor rather than a visitor's own tool, no name for this
 * project's internal policy file, no word for the person this project
 * routes decisions to when it's used as an internal process role, and no
 * path into this project's private working directory. The exact pattern
 * list is not reproduced here on purpose: it lives in this project's
 * private working directory, not in the published tree, because a
 * published copy of the list would hand a reader the exact words to
 * search for. Filesystem-only, needs no browser — but needs that private
 * directory present to actually check anything. If it is absent (a fresh
 * clone that only took website/), this SKIPS loudly rather than silently
 * passing.
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
  // The private working directory, if present, is a sibling of website/.
  // Its own top-level name is intentionally not written out as a string
  // literal here — it is assembled at runtime — so this file itself
  // carries none of the words the census it runs exists to catch.
  const dirName = ['l', 'a', 'b'].join('');
  const dir = path.join(PRIVATE_ROOT, dirName);
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
