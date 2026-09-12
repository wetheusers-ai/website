/* Builds fixtures/apple/apple-export.zip — a synthetic, minimal stand-in
 * for an Apple "Data & Privacy" export. All names, devices, cities, and
 * files in it are invented (see fixture-data.js). Run with:
 *
 *   node website/shadow/fixtures/apple/build-fixture.js
 *
 * Lays out one file per shape parsers/apple.js reads (App Store activity,
 * Apple Media Services — one CSV form and one JSON form, to exercise both
 * — Apple ID sign-in history, iCloud Drive file metadata), under folder
 * names built from the category names Apple's own support page documents
 * (see apple.js's file header for the citation and its limits), plus
 * decoys — Mail, a Photos placeholder, a Messages export, and a stray PDF
 * sitting inside a real category folder — that must never be opened by
 * the parser at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();

// -- App Store --
zip.file('App Store/App Store Activity.csv', D.appStoreCsv);
zip.file('App Store/App Store Terms.pdf', D.decoyAppStoreTermsPdf); // decoy: wrong extension, never opened

// -- Apple Media Services Information: one CSV file, one JSON file --
zip.file('Apple Media Services Information/Apple Media Services - Purchases and Plays.csv', D.mediaServicesCsv);
zip.file('Apple Media Services Information/Media Services Activity.json', JSON.stringify(D.mediaServicesJson));

// -- Apple ID Account and Device Information --
zip.file('Apple ID Account and Device Information/Sign-In History.csv', D.signInCsv);

// -- iCloud Drive --
zip.file('iCloud Drive/iCloud Drive Files.csv', D.icloudDriveCsv);

// -- decoys: must never be opened at all --
zip.file('Mail/All Mail Including Junk And Trash.eml', D.decoyMail);
zip.file('Photos/Photos from 2021/IMG_0001.HEIC', D.decoyPhoto);
zip.file('Messages/Messages Export.json', D.decoyMessagesJson);

zip
  .generateAsync({ type: 'nodebuffer' })
  .then((buf) => {
    const out = path.join(__dirname, 'apple-export.zip');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
