/* Synthetic, non-Meta export data — shaped like a Google Takeout
 * `MyActivity.json` file (an array of `{time, title}` records under a path
 * containing both "takeout" and "myactivity"). Built to exercise the
 * generic `harvest()`/`scan()` path in website/shadow/index.html, specifically
 * the "title" key of scan()'s keyword regex, which a bug (the key's
 * closing quote sitting inside the alternation) prevented from ever
 * matching before W-15. All names and search terms here are invented.
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
  PATH: 'Takeout/My Activity/Search/MyActivity.json',
  EXPECTED: {
    // Every entry contributes 3 non-stopword words >3 chars from its title
    // ("mortgage refinance rates", "near"/"me" are both stopwords) — 90 x 3
    // = 270, comfortably over the >200 threshold render() requires before
    // showing "The inferences".
    minWords: 200,
    events: ENTRY_COUNT,
  },
};
