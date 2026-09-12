/* Synthetic, non-real data for the X (Twitter) archive fixture. Every
 * handle, name, and advertiser below is invented for this fixture — no real
 * account or advertiser appears here. Shared by build-fixture.js (which
 * writes the zip) and test/x.test.js (which checks the parser against it),
 * so the expected counts and the generated data can never drift apart.
 *
 * Exercises every shape parsers/x.js is built to read (tweets, likes,
 * direct messages, ad impressions, ad engagements, account) plus one file
 * at a data/*.js path whose content is NOT window.YTD-wrapped, and one
 * window.YTD-wrapped file under an unexpected key — proving the parser
 * routes on content, not on the path or an assumed key list.
 */
'use strict';

const iso = (s) => Math.floor(Date.parse(s) / 1000); // epoch seconds

// -- tweets.js ---------------------------------------------------------
const tweets = [
  { tweet: { id_str: '1001', created_at: 'Tue Mar 01 10:15:00 +0000 2019', full_text: 'a fictitious post, one' } },
  { tweet: { id_str: '1002', created_at: 'Wed Jul 15 08:30:00 +0000 2020', full_text: 'a fictitious post, two' } },
  { tweet: { id_str: '1003', created_at: 'Sat Nov 20 19:45:00 +0000 2021', full_text: 'a fictitious post, three' } },
  // malformed: no "tweet" wrapper at all — must be skipped and counted, not
  // treated as a reason to drop the whole file.
  { notATweet: true },
];

// -- like.js -------------------------------------------------------------
const likes = [
  { like: { tweetId: '9001', fullText: 'a fictitious liked post, one' } },
  { like: { tweetId: '9002', fullText: 'a fictitious liked post, two' } },
  { like: { tweetId: '9003', fullText: 'a fictitious liked post, three' } },
  { like: { tweetId: '9004', fullText: 'a fictitious liked post, four' } },
  { notALike: true }, // malformed — skipped and counted
];

// -- direct-messages.js — counts only; text/participants must never be read --
const directMessages = [
  {
    dmConversation: {
      conversationId: '111-222',
      messages: [
        { messageCreate: { id: 'm1', text: 'a fictitious message, never read by this parser' } },
        { messageCreate: { id: 'm2', text: 'a second fictitious message' } },
      ],
    },
  },
  {
    dmConversation: {
      conversationId: '111-333',
      messages: [{ messageCreate: { id: 'm3', text: 'a fictitious message in a second conversation' } }],
    },
  },
];

// -- ad-impressions.js — one fictitious advertiser repeats, to prove counting --
const adImpressions = [
  {
    ad: {
      adsUserData: {
        adImpressions: {
          impressions: [
            { advertiserInfo: { advertiserName: 'Fictional Outfitters Co.' }, displayLocation: 'TimelineHome' },
            { advertiserInfo: { advertiserName: 'Fictional Outfitters Co.' }, displayLocation: 'TimelineHome' },
            { advertiserInfo: { advertiserName: 'Imaginary Kettle Traders' }, displayLocation: 'ProfileTweet' },
            { displayLocation: 'TimelineHome' }, // malformed: no advertiser name — skipped and counted
          ],
        },
      },
    },
  },
];

// -- ad-engagements.js — a different fictitious advertiser mix ------------
// One record in each of the two shapes extractAdvertiserName() reads: the
// documented one (alkihis/twitter-archive-reader's GDPRAds.d.ts —
// advertiser nested under impressionAttributes.advertiserInfo) and the flat
// one this parser originally targeted. Neither shape is confirmed against
// X's own archive documentation, so both are exercised rather than one
// standing in for a real export.
const adEngagements = [
  {
    ad: {
      adsUserData: {
        adEngagements: {
          engagements: [
            {
              impressionAttributes: { advertiserInfo: { advertiserName: 'Fictional Outfitters Co.' } },
              engagementAttributes: [{ engagementType: 'Click' }],
            },
            { advertiserInfo: { advertiserName: 'Not Real Wireless Ltd.' }, engagementType: 'Favorite' },
          ],
        },
      },
    },
  },
];

// -- account.js — the archive owner ---------------------------------------
const account = [
  {
    account: {
      email: 'fixture@example.invalid',
      createdVia: 'web',
      username: 'fixture_owner',
      accountId: '000000001',
      createdAt: '2015-01-01T00:00:00.000Z',
      accountDisplayName: 'Fixture Owner',
    },
  },
];

// -- decoys ----------------------------------------------------------------
// Sits at a real YTD data path but carries no window.YTD wrapper at all —
// must never be trusted as tweet/like/etc. data.
const decoyUnwrapped = '// not a YTD file\nconsole.log("just a script, not window.YTD-wrapped");\n';

// A real window.YTD wrapper, but a key this parser does not read (e.g. a
// future or unhandled export file) — must be scanned, but never matched.
const decoyUnknownKey = 'window.YTD.moment.part0 = ' + JSON.stringify([{ moment: { title: 'not a shape this parser reads' } }]) + ';';

// -- expected aggregate result ---------------------------------------------
const EXPECTED = {
  tweetCount: 3,
  tweetSkipped: 1,
  likeCount: 4,
  likeSkipped: 1,
  dmConversationCount: 2,
  dmMessageCount: 3,
  adImpressionAdvertiserCount: 2, // Fictional Outfitters Co., Imaginary Kettle Traders
  adImpressionTotal: 3, // 2 + 1 (the fourth record is skipped, no name)
  adEngagementAdvertiserCount: 2, // Fictional Outfitters Co., Not Real Wireless Ltd.
  adEngagementTotal: 2,
  ownerUsername: 'fixture_owner',
  ownerDisplayName: 'Fixture Owner',
  spanMinIso: 'Tue Mar 01 10:15:00 +0000 2019',
  spanMaxIso: 'Sat Nov 20 19:45:00 +0000 2021',
  filesScanned: 8, // 6 real YTD files + decoyUnwrapped + decoyUnknownKey
  filesMatched: 6,
};

module.exports = {
  iso,
  tweets,
  likes,
  directMessages,
  adImpressions,
  adEngagements,
  account,
  decoyUnwrapped,
  decoyUnknownKey,
  EXPECTED,
};
