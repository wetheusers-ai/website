/* Builds fixtures/generic/generic-export.zip — a synthetic, minimal
 * stand-in for a data export from a platform nothing here recognizes yet
 * (an array of {time, title} records — NOT shaped like Meta or, since W-02,
 * Google Takeout, both of which now get their own shape-based parser). Used
 * by test/residuals.test.js to exercise the generic harvest()/scan() path,
 * in particular the "title" key regression fixed in W-15. Run with:
 *
 *   node website/shadow/fixtures/generic/build-fixture.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();
zip.file(D.PATH, JSON.stringify(D.ENTRIES));

zip
  .generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  .then((buf) => {
    const out = path.join(__dirname, 'generic-export.zip');
    fs.writeFileSync(out, buf);
    console.log(`wrote ${out} (${buf.length} bytes)`);
  });
