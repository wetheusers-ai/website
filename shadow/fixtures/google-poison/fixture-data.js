/* Fixture data for fixtures/google-poison/google-poison-export.zip — a
 * Takeout-shaped archive with one hostile folder name, built to prove the
 * BLOCKING finding from 12 September 2026 stays closed:
 * lab/factory/queue/decisions/2026-09-12-BLOCKING-shadow-malicious-file-exfiltrates.md
 *
 * The folder name under `Takeout/My Activity/` is exactly the payload the
 * red team used: `<img src=x onerror="window.__pwned=1">`. GoogleParser
 * reads that folder name as a product name (parsers/google.js's
 * MY_ACTIVITY_RE capture group), and render() in shadow/index.html used to
 * interpolate it into the "products" headline's innerHTML unescaped. All
 * records here are invented; no real export was used to build this.
 */
'use strict';

const PAYLOAD_FOLDER = '<img src=x onerror="window.__pwned=1">';

// 25 records, one per synthetic "search," each a real ISO timestamp so the
// span/rhythm findings fire (render() needs > 8 timestamps for "the span"
// and the whole page needs >= 20 events to get past the "found little"
// early return) and isActivityArray()'s 80%-timed-rows check passes.
const poisoned = [];
for (let i = 0; i < 25; i++) {
  const month = String(1 + (i % 12)).padStart(2, '0');
  const day = String(1 + (i % 27)).padStart(2, '0');
  poisoned.push({
    header: 'Search',
    title: `Searched for fictitious thing number ${i}`,
    time: `20${10 + (i % 14)}-${month}-${day}T10:15:00.000Z`,
    products: [PAYLOAD_FOLDER],
  });
}

module.exports = { PAYLOAD_FOLDER, poisoned };
