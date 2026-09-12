/* Builds fixtures/generic/generic-export.zip — a synthetic, minimal
 * stand-in for a data export from a platform nothing here recognizes yet
 * (an array of {time, title} records — NOT shaped like Meta or Google
 * Takeout, both of which get their own shape-based parser). Used by
 * test/residuals.test.js to exercise the generic harvest()/scan() path,
 * in particular the "title" key regex match. Run with:
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
