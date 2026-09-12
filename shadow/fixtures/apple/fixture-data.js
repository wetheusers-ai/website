/* Synthetic, non-real data for the Apple "Data & Privacy" export fixture.
 * Every app, song, podcast, device, city, and file name below is invented
 * for this fixture — no real person, place, or purchase appears here. The
 * folder and file NAMES here are also invented, not a confirmed
 * transcription of Apple's real export — see parsers/apple.js's file
 * header for why (Apple does not publish an exact schema the way Google's
 * Takeout does). Shared by build-fixture.js (which writes the zip) and
 * test/apple.test.js (which checks the parser against it), so the expected
 * counts and the generated data can never drift apart.
 */
'use strict';

const iso = (s) => Math.floor(Date.parse(s) / 1000); // epoch seconds

// -- a small CSV writer, the mirror image of parsers/apple.js's reader --
function csvField(v) {
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(header, rows) {
  const lines = [header.map(csvField).join(',')];
  rows.forEach((r) => lines.push(r.map(csvField).join(',')));
  return lines.join('\r\n') + '\r\n'; // \r\n line endings, as a spreadsheet export commonly writes
}

// -- App Store/App Store Activity.csv ----------------------------------
const appStoreHeader = ['Item Type', 'Item Title', 'Event', 'Event Date'];
const appStoreRows = [
  ['App', 'Fictitious Weather App', 'Download', '2019-01-10T08:00:00Z'],
  ['App', 'Imaginary Notes App', 'Update', '2020-05-05T09:30:00Z'],
  ['App', 'Made-Up Puzzle Game', 'Purchase', '2022-08-08T18:45:00Z'],
];
const appStoreCsv = toCsv(appStoreHeader, appStoreRows);

// -- Apple Media Services Information/Apple Media Services - Purchases and Plays.csv --
const mediaServicesHeader = ['Content Name', 'Content Type', 'Event Type', 'Event Date'];
const mediaServicesRows = [
  ['Invented Song One', 'Song', 'Play', '2018-11-11T05:00:00Z'],
  ['Invented Album Two', 'Album', 'Purchase', '2021-02-02T14:15:00Z'],
];
const mediaServicesCsv = toCsv(mediaServicesHeader, mediaServicesRows);

// -- Apple Media Services Information/Media Services Activity.json --
// A second, JSON-shaped file in the same category — proves the parser
// reads both forms Apple documents for "app usage information"
// (HT208502: ".json, .csv, or .pdf").
const mediaServicesJson = [
  { title: 'Invented Podcast Episode', eventType: 'Play', eventDate: '2023-04-01T10:00:00Z' },
  { title: 'Invented Movie Rental', eventType: 'Purchase', eventDate: '2024-04-04T04:04:00Z' },
];

// -- Apple ID Account and Device Information/Sign-In History.csv --------
// Two sign-ins on the same UTC calendar day (2020-01-01) from different
// invented devices, one on a later day, and one with no location value at
// all — exercising both location-day de-duplication and the "location is
// optional, not assumed" handling.
const signInHeader = ['Sign In Date', 'Device', 'Location'];
const signInRows = [
  ['2020-01-01T09:00:00Z', 'Fictitious iPhone', 'Austin, TX, US'],
  ['2020-01-01T20:00:00Z', 'Fictitious MacBook', 'Austin, TX, US'],
  ['2022-06-15T12:00:00Z', 'Fictitious iPad', 'Berlin, DE'],
  ['2023-07-01T08:00:00Z', 'Fictitious Apple TV', ''],
];
const signInCsv = toCsv(signInHeader, signInRows);

// -- iCloud Drive/iCloud Drive Files.csv --------------------------------
// Two files modified on the same day, one much later — no location concept
// here, only event count and span.
const icloudDriveHeader = ['File Name', 'File Size (Bytes)', 'Last Modified Date'];
const icloudDriveRows = [
  ['Fictitious Report.pdf', '102400', '2021-03-03T10:00:00Z'],
  ['Imaginary Spreadsheet.numbers', '20480', '2021-03-03T11:30:00Z'],
  ['Made-Up Presentation.key', '512000', '2024-12-01T00:00:00Z'],
];
const icloudDriveCsv = toCsv(icloudDriveHeader, icloudDriveRows);

// -- decoys: must never be opened at all --------------------------------
const decoyMail = 'From: nobody@example.invalid\r\nSubject: fixture placeholder, not a real message\r\n';
const decoyPhoto = 'not a real image, fixture placeholder bytes';
const decoyMessagesJson = JSON.stringify({ hello: 'world', numbers: [1, 2, 3] });
const decoyAppStoreTermsPdf = '%PDF-1.4 fixture placeholder, not a real PDF';

// -- expected aggregate result ------------------------------------------
const eventCount =
  appStoreRows.length + mediaServicesRows.length + mediaServicesJson.length + signInRows.length + icloudDriveRows.length;

const EXPECTED = {
  services: ['App Store', 'Apple Media Services', 'Apple ID sign-in history', 'iCloud Drive'],
  serviceCount: 4,
  eventCount, // 14
  locationDays: 2, // 2020-01-01, 2022-06-15 (Sign-In History only; the empty-location row adds nothing)
  spanMinIso: '2018-11-11T05:00:00Z', // Apple Media Services CSV, row one
  spanMaxIso: '2024-12-01T00:00:00Z', // iCloud Drive Files.csv, row three
  filesScanned: 5,
  filesMatched: 5,
};

module.exports = {
  iso,
  toCsv,
  appStoreCsv,
  mediaServicesCsv,
  mediaServicesJson,
  signInCsv,
  icloudDriveCsv,
  decoyMail,
  decoyPhoto,
  decoyMessagesJson,
  decoyAppStoreTermsPdf,
  EXPECTED,
};
