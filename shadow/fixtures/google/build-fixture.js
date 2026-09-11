/* Builds fixtures/google/google-export.zip — a synthetic, minimal stand-in
 * for a real Google Takeout archive. All names, places, and businesses in
 * it are invented (see fixture-data.js). Run with:
 *
 *   node website/shadow/fixtures/google/build-fixture.js
 *
 * Lays out one file per shape parsers/google.js reads (My Activity, the
 * top-level Ads/ form, YouTube history, Location History Records.json,
 * Semantic Location History), under Takeout's own real folder names, plus
 * decoys — a Gmail mbox, a Drive placeholder, a Google Photos sidecar JSON,
 * and Takeout's own archive_browser.html manifest — that must never be
 * opened by the parser at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();

// -- Takeout's own manifest, at the archive root --
zip.file('Takeout/archive_browser.html', D.decoyArchiveBrowser);

// -- My Activity: one MyActivity.json per product --
zip.file('Takeout/My Activity/Search/MyActivity.json', JSON.stringify(D.search));
zip.file('Takeout/My Activity/YouTube/MyActivity.json', JSON.stringify(D.youtubeActivity));
zip.file('Takeout/My Activity/Maps/MyActivity.json', JSON.stringify(D.maps));
zip.file('Takeout/My Activity/Ads/MyActivity.json', JSON.stringify(D.adsMyActivity));

// -- Ads/*.json at the top level — an older/alternate layout --
zip.file('Takeout/Ads/Ads Activity.json', JSON.stringify(D.adsTopLevel));

// -- YouTube and YouTube Music/history/*.json --
zip.file('Takeout/YouTube and YouTube Music/history/watch-history.json', JSON.stringify(D.watchHistory));
zip.file('Takeout/YouTube and YouTube Music/history/search-history.json', JSON.stringify(D.searchHistory));

// -- Location History (Timeline)/Records.json --
zip.file('Takeout/Location History (Timeline)/Records.json', JSON.stringify({ locations: D.locationRecords }));

// -- Location History/Semantic Location History/<year>/<year>_<MONTH>.json --
// The real Takeout layout nests this under the Location History folder —
// see the citations on SEMANTIC_LOCATION_RE in parsers/google.js.
zip.file('Takeout/Location History/Semantic Location History/2022/2022_MARCH.json', JSON.stringify({ timelineObjects: D.semanticTimeline }));

// -- decoys: must never be opened by the parser --
zip.file('Takeout/Mail/All mail Including Spam and Trash.mbox', D.decoyGmail);
zip.file('Takeout/Drive/Fictitious Document.gdoc', D.decoyDrive);
zip.file('Takeout/Google Photos/Photos from 2021/IMG_0001.jpg.json', D.decoyPhotosMetadata);

zip
  .generateAsync({ type: 'nodebuffer' })
  .then((buf) => {
    const out = path.join(__dirname, 'google-export.zip');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
