/* Synthetic, non-Meta, non-Google export data — an array of `{time, title}`
 * records at a path containing "myactivity" but deliberately NOT rooted at
 * "Takeout/" or naming one of Takeout's own product folders, so it exercises
 * the generic `harvest()`/`scan()` path rather than parsers/google.js (Google
 * Takeout gets its own shape-based parser; this fixture's whole job is to
 * stand in for an export format nothing recognizes yet). Also exercises the
 * "title" key of scan()'s keyword regex, whose alternation must actually
 * match a bare "title" key and not just the other four. All names and
 * search terms here are invented.
 */
'use strict';

const TOPICS = [
  'mortgage refinance rates',
  'toddler fever symptoms',
  'knee pain running shoes',
  'flight cancellation policy',
  'therapist accepting patients',
  'divorce lawyer cost',
  'python async tutorial',
  'sleep training method',
  'deductible health plan',
  'layoff severance package',
  'anxiety symptoms checklist',
  'used bikes trade offer',
];

const ENTRY_COUNT = 90;
const BASE_MS = Date.UTC(2024, 0, 1);

const ENTRIES = [];
for (let i = 0; i < ENTRY_COUNT; i++) {
  const topic = TOPICS[i % TOPICS.length];
  ENTRIES.push({
    header: 'Search',
    title: `Searched for ${topic} near me`,
    time: new Date(BASE_MS + i * 3 * 3600 * 1000).toISOString(),
  });
}

module.exports = {
  TOPICS,
  ENTRIES,
  PATH: 'Export/My Activity/Search/MyActivity.json',
  EXPECTED: {
    // Every entry contributes 3 non-stopword words >3 chars from its title
    // ("mortgage refinance rates", "near"/"me" are both stopwords) — 90 x 3
    // = 270, comfortably over the >200 threshold render() requires before
    // showing "The inferences".
    minWords: 200,
    events: ENTRY_COUNT,
  },
};
