/* Builds fixtures/x/x-export.zip — a synthetic, minimal stand-in for a real
 * X (Twitter) archive. All names, handles, and advertisers in it are
 * invented (see fixture-data.js). Run with:
 *
 *   node website/shadow/fixtures/x/build-fixture.js
 *
 * Lays out one data/*.js file per shape parsers/x.js reads, each wrapped in
 * the real `window.YTD.<name>.partN = ... ;` form, plus:
 *   - a decoy at a real data/*.js path that carries no YTD wrapper at all
 *   - a decoy that IS YTD-wrapped, but under a key this parser never reads
 *   - the archive's own root HTML and an assets/ file, which a real X
 *     archive ships and this parser must never open
 * — proving detection and classification both go by content, not path.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();

const wrap = (name, part, value) => `window.YTD.${name}.part${part} = ${JSON.stringify(value)};`;

zip.file('data/tweets.js', wrap('tweets', 0, D.tweets));
zip.file('data/like.js', wrap('like', 0, D.likes));
zip.file('data/direct-messages.js', wrap('direct_messages', 0, D.directMessages));
zip.file('data/ad-impressions.js', wrap('ad_impressions', 0, D.adImpressions));
zip.file('data/ad-engagements.js', wrap('ad_engagements', 0, D.adEngagements));
zip.file('data/account.js', wrap('account', 0, D.account));

// -- decoys: must never be trusted as data, or must never be opened at all --
zip.file('data/not-really-ytd.js', D.decoyUnwrapped);
zip.file('data/moment.js', D.decoyUnknownKey);
zip.file('Your archive.html', '<!doctype html><title>Fixture archive placeholder</title>');
zip.file('assets/fixture.css', '/* fixture placeholder, not a real stylesheet */');

zip
  .generateAsync({ type: 'nodebuffer' })
  .then((buf) => {
    const out = path.join(__dirname, 'x-export.zip');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
