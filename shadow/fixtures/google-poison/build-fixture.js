/* Builds fixtures/google-poison/google-poison-export.zip — a Takeout-shaped
 * archive with one hostile folder name under `Takeout/My Activity/`, used
 * by test/xss.test.js to prove the stored-XSS finding from 12 September
 * 2026 stays closed:
 * lab/factory/queue/decisions/2026-09-12-BLOCKING-shadow-malicious-file-exfiltrates.md
 *
 * Run with:
 *   node website/shadow/fixtures/google-poison/build-fixture.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();
zip.file(`Takeout/My Activity/${D.PAYLOAD_FOLDER}/MyActivity.json`, JSON.stringify(D.poisoned));

zip
  .generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  .then((buf) => {
    const out = path.join(__dirname, 'google-poison-export.zip');
    fs.writeFileSync(out, buf);
    console.log(`wrote ${out} (${buf.length} bytes)`);
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
