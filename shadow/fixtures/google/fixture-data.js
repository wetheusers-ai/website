/* Synthetic, non-real data for the Google Takeout export fixture. Every
 * place, person, business, and video named below is invented for this
 * fixture — no real advertiser, channel, or location appears here. Shared
 * by build-fixture.js (which writes the zip) and test/google.test.js
 * (which checks the parser against it), so the expected counts and the
 * generated data can never drift apart.
 *
 * Deliberately exercises every shape parsers/google.js is built to read —
 * one file per "Must handle" item in the task this fixture closes — plus a
 * handful of decoys (Gmail, Drive, Google Photos, the Takeout manifest
 * itself) that must never be opened at all.
 */
'use strict';

const ms = (s) => Date.parse(s); // epoch milliseconds
const iso = (s) => Math.floor(Date.parse(s) / 1000); // epoch seconds

// -- My Activity: one MyActivity.json per product ---------------------------
const search = [
  { header: 'Search', title: 'Searched for fictitious kayak rentals', time: '2019-03-01T10:15:00.000Z', products: ['Search'] },
  { header: 'Search', title: 'Searched for an imaginary sourdough recipe', time: '2020-07-15T08:30:00.000Z', products: ['Search'] },
  { header: 'Search', title: 'Searched for pretend hiking trails', time: '2021-11-20T19:45:00.000Z', products: ['Search'] },
];

const youtubeActivity = [
  { header: 'YouTube', title: 'Watched Fictional Channel: an invented tutorial', time: '2020-01-05T12:00:00.000Z', products: ['YouTube'] },
  { header: 'YouTube', title: 'Watched Fictional Channel: another invented clip', time: '2022-02-14T21:10:00.000Z', products: ['YouTube'] },
];

const maps = [
  { header: 'Maps', title: 'Searched for Fictitious Diner', time: '2021-05-09T13:00:00.000Z', products: ['Maps'] },
  { header: 'Maps', title: 'Got directions to Made-Up Trailhead', time: '2023-06-18T17:25:00.000Z', products: ['Maps'] },
];

const adsMyActivity = [
  {
    header: 'Ads', title: 'Saw an ad', time: '2021-09-01T09:00:00.000Z', products: ['Ads'],
    subtitles: [{ name: 'Fictional Outfitters Co.', url: 'https://example.invalid/a' }],
  },
  {
    header: 'Ads', title: 'Saw an ad', time: '2022-10-12T14:20:00.000Z', products: ['Ads'],
    subtitles: [{ name: 'Imaginary Kettle Traders', url: 'https://example.invalid/b' }],
  },
];

// -- Ads/*.json at the archive's top level — an older/alternate layout ------
// One advertiser name repeats from adsMyActivity above, to prove
// de-duplication across the two Ads-shaped files.
const adsTopLevel = [
  {
    header: 'Ads', title: 'Saw an ad', time: '2024-01-03T11:11:00.000Z', products: ['Ads'],
    subtitles: [{ name: 'Fictional Outfitters Co.', url: 'https://example.invalid/c' }],
  },
  {
    header: 'Ads', title: 'Saw an ad', time: '2024-04-04T04:04:00.000Z', products: ['Ads'],
    subtitles: [{ name: 'Not Real Wireless Ltd.', url: 'https://example.invalid/d' }],
  },
];

// -- YouTube and YouTube Music/history/*.json --------------------------------
const watchHistory = [
  { header: 'YouTube', title: 'Watched an invented video, one', time: '2018-12-25T06:00:00.000Z', products: ['YouTube'] },
  { header: 'YouTube', title: 'Watched an invented video, two', time: '2019-08-08T08:08:00.000Z', products: ['YouTube'] },
  { header: 'YouTube', title: 'Watched an invented video, three', time: '2020-02-02T02:02:00.000Z', products: ['YouTube'] },
];
const searchHistory = [
  { header: 'YouTube', title: 'Searched an invented topic', time: '2023-03-03T03:03:00.000Z', products: ['YouTube'] },
];

// -- Location History (Timeline)/Records.json --------------------------------
// Mixes both field shapes Google has shipped on this file: an older
// `timestampMs` string, and a newer `timestamp` ISO string — on entries in
// the SAME file, since that is what a Records.json spanning a format change
// actually looks like.
const locationRecords = [
  { latitudeE7: 407128000, longitudeE7: -740060000, timestampMs: String(ms('2021-06-01T12:00:00.000Z')) },
  { latitudeE7: 407128000, longitudeE7: -740060000, timestampMs: String(ms('2021-06-01T18:30:00.000Z')) }, // same day as above
  { latitudeE7: 340052000, longitudeE7: -1182437000, timestampMs: String(ms('2021-06-02T09:00:00.000Z')) }, // next day
  { latitudeE7: 471234500, longitudeE7: -1224567800, timestamp: '2024-12-25T00:00:00.000Z' }, // newer field shape; also the fixture's overall latest timestamp
];

// -- Location History/Semantic Location History/<year>/<year>_<MONTH>.json --
const semanticTimeline = [
  {
    placeVisit: {
      location: { name: 'Fictitious Landmark' },
      duration: { startTimestamp: '2022-03-05T09:00:00.000Z', endTimestamp: '2022-03-05T10:00:00.000Z' },
    },
  },
  {
    activitySegment: {
      duration: { startTimestamp: '2022-03-05T10:15:00.000Z', endTimestamp: '2022-03-05T10:45:00.000Z' }, // same day as above
    },
  },
  {
    placeVisit: {
      location: { name: 'Made-Up Park' },
      duration: { startTimestamp: '2022-03-20T15:00:00.000Z', endTimestamp: '2022-03-20T16:00:00.000Z' }, // a new day
    },
  },
];

// -- decoys: must never be opened at all --------------------------------
const decoyGmail = 'From nobody@example.invalid  Mon Jan  1 00:00:00 2024\nSubject: fixture placeholder, not a real message\n';
const decoyDrive = 'not a real Drive file, fixture placeholder bytes';
const decoyPhotosMetadata = JSON.stringify({ title: 'IMG_0001.jpg', creationTime: { timestamp: '1600000000' } });
const decoyArchiveBrowser = '<!doctype html><title>Fixture archive_browser placeholder</title>';

// -- expected aggregate result ------------------------------------------
// What a correct parser must produce from the archive built from the data
// above. This is the falsifiable contract test/google.test.js checks.
const uniqueAdvertisers = [
  ...new Set([
    ...adsMyActivity.map((a) => a.subtitles[0].name),
    ...adsTopLevel.map((a) => a.subtitles[0].name),
  ]),
];

const eventCount =
  search.length + youtubeActivity.length + maps.length + adsMyActivity.length + adsTopLevel.length +
  watchHistory.length + searchHistory.length;

const EXPECTED = {
  products: ['Search', 'YouTube', 'Maps', 'Ads'], // order-independent in the test
  productCount: 4,
  eventCount, // 15
  advertiserCount: uniqueAdvertisers.length, // 3
  advertisers: uniqueAdvertisers,
  locationDays: 5, // 2021-06-01, 2021-06-02, 2024-12-25 (Records.json) + 2022-03-05, 2022-03-20 (Semantic)
  spanMinIso: '2018-12-25T06:00:00.000Z', // watch-history, entry one
  spanMaxIso: '2024-12-25T00:00:00.000Z', // Records.json, newest-shape entry
  filesScanned: 9,
  filesMatched: 9,
};

module.exports = {
  ms,
  iso,
  search,
  youtubeActivity,
  maps,
  adsMyActivity,
  adsTopLevel,
  watchHistory,
  searchHistory,
  locationRecords,
  semanticTimeline,
  decoyGmail,
  decoyDrive,
  decoyPhotosMetadata,
  decoyArchiveBrowser,
  uniqueAdvertisers,
  EXPECTED,
};
