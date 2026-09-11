/* Builds fixtures/meta/meta-export.zip — a synthetic, minimal stand-in for
 * a real Instagram/Facebook data export. All names in it are invented (see
 * fixture-data.js). Run with:
 *
 *   node website/shadow/fixtures/meta/build-fixture.js
 *
 * Deliberately spreads the same kind of content across paths from different
 * eras of Meta's export layout, plus one file at a path with none of the
 * known hints, to prove the parser detects content by shape rather than by
 * location. Also includes two decoy JSON files and one binary-ish file that
 * must NOT be picked up by the parser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('../../vendor/jszip.min.js');
const D = require('./fixture-data.js');

const zip = new JSZip();

// -- advertisers: two eras of the same file, two different shapes of wrapper key --
zip.file(
  'ads_information/advertisers_using_your_activity.json',
  JSON.stringify({
    ig_custom_audiences_all_types: D.advertisersFileA.map((n) => ({ advertiser_name: n })),
  })
);

// Unexpected path, unexpected wrapper key — only the shape of the entries
// (advertiser_name) makes this detectable.
zip.file(
  'data/misc/export_chunk_07.json',
  JSON.stringify({
    advertisers_who_uploaded_a_contact_list_with_your_information_in_it: D.advertisersFileB.map((n) => ({
      advertiser_name: n,
    })),
  })
);

// -- message threads --
D.threads.forEach((t) => {
  t.files.forEach((f) => {
    zip.file(
      `${t.folder}/${f.name}`,
      JSON.stringify({
        participants: f.participants.map((name) => ({ name })),
        messages: f.messages,
        title: t.folder.split('/').pop(),
        thread_type: f.participants.length > 2 ? 'RegularGroup' : 'Regular',
      })
    );
  });
});

// -- posts --
zip.file('your_instagram_activity/content/posts_1.json', JSON.stringify(D.posts));

// -- ads_and_topics --
zip.file(
  'ads_information/ads_and_topics/ads_viewed.json',
  JSON.stringify({ impressions_history_ads_seen: D.adsViewed })
);
zip.file(
  'ads_information/ads_and_topics/your_topics.json',
  JSON.stringify({ topics_your_topics: D.topics.map((name) => ({ name })) })
);

// -- decoys: must not be picked up as anything --
zip.file('random_other_platform/export.json', JSON.stringify({ hello: 'world', numbers: [1, 2, 3] }));
zip.file('random_other_platform/products.json', JSON.stringify([{ sku: 'A1' }, { sku: 'A2' }]));
zip.file('your_instagram_activity/media/photo_placeholder.jpg', 'not a real image, fixture placeholder bytes');

zip
  .generateAsync({ type: 'nodebuffer' })
  .then((buf) => {
    const out = path.join(__dirname, 'meta-export.zip');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('build-fixture failed:', e);
    process.exit(1);
  });
