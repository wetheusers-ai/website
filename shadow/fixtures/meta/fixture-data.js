/* Synthetic data for the Meta (Instagram/Facebook) export fixture.
 * Every name below is invented for this fixture — no real advertiser,
 * person, or account appears here. Shared by build-fixture.js (which writes
 * the zip) and test/meta.test.js (which checks the parser against it), so
 * the expected counts and the generated data can never drift apart.
 */
'use strict';

const iso = (s) => Math.floor(Date.parse(s) / 1000); // epoch seconds
const ms = (s) => Date.parse(s); // epoch milliseconds

// -- advertisers -------------------------------------------------------
// File A sits at the path Meta has documented for this export
// ("ads_information/advertisers_using_your_activity.json") — exercises the
// fast route.
const advertisersFileA = [
  'Fictitious Kettle Co.',
  'Not-A-Real Bank of Testonia',
  'Sample Sneaker Outpost',
  'Imaginary Airlines Ltd',
  'Placeholder Pet Supply',
];

// File B sits at a path with none of the known hints, under a wrapper key
// nobody has used before — the only thing that makes it detectable is the
// shape of its entries (each has advertiser_name). One name overlaps with
// File A to prove de-duplication.
const advertisersFileB = [
  'Sample Sneaker Outpost',
  'Faux Furniture Traders',
  'Wholly Fictional Wireless',
  'Test Data Toy Co.',
];

const uniqueAdvertisers = [...new Set([...advertisersFileA, ...advertisersFileB])];

// -- message threads -----------------------------------------------------
// Four conversations. The second is split across two chunk files
// (message_1.json, message_2.json) in the same folder, to exercise
// chunk-merging: it must still count as one thread. The account owner,
// "You Test Person", appears in every thread's participants — exactly as
// real Meta exports shape it, and exactly what makes detectOwner() able to
// identify (and exclude) the owner instead of ranking them first. The
// fourth thread is a forty-one-person group with a message count much
// larger than any of the real one-on-one threads, to prove weighting
// divides it down instead of letting it dominate the ranking.
const OWNER = 'You Test Person';
const bigGroupOthers = Array.from({ length: 40 }, (_, i) => `Group Member ${String(i + 1).padStart(2, '0')}`);
const bigGroupMessages = Array.from({ length: 120 }, (_, i) => ({
  sender_name: bigGroupOthers[i % bigGroupOthers.length],
  timestamp_ms: ms('2024-06-01T00:00:00Z'),
  content: 'hi',
}));

const threads = [
  {
    folder: 'your_instagram_activity/messages/inbox/friendly_fictioneer_abc123',
    files: [
      {
        name: 'message_1.json',
        participants: ['Fictional Friend One', OWNER],
        messages: [
          { sender_name: 'Fictional Friend One', timestamp_ms: ms('2021-03-05T10:00:00Z'), content: 'hi' },
          { sender_name: OWNER, timestamp_ms: ms('2021-03-06T11:30:00Z'), content: 'hey' },
          { sender_name: 'Fictional Friend One', timestamp_ms: ms('2021-04-01T09:15:00Z'), content: 'lunch?' },
          { sender_name: OWNER, timestamp_ms: ms('2021-04-02T20:45:00Z'), content: 'sure' },
        ],
      },
    ],
  },
  {
    folder: 'your_instagram_activity/messages/inbox/testville_group_xyz789',
    files: [
      {
        name: 'message_1.json',
        participants: ['Fictional Friend Two', 'Fictional Friend Three', OWNER],
        messages: [
          { sender_name: 'Fictional Friend Two', timestamp_ms: ms('2022-06-01T08:00:00Z'), content: 'yo' },
          { sender_name: 'Fictional Friend Three', timestamp_ms: ms('2022-06-01T08:05:00Z'), content: 'sup' },
        ],
      },
      {
        name: 'message_2.json',
        participants: ['Fictional Friend Two', 'Fictional Friend Three', OWNER],
        messages: [
          { sender_name: OWNER, timestamp_ms: ms('2022-06-15T14:20:00Z'), content: 'later' },
        ],
      },
    ],
  },
  {
    folder: 'your_instagram_activity/messages/inbox/quietcorner_def456',
    files: [
      {
        name: 'message_1.json',
        participants: ['Fictional Friend Four', OWNER],
        messages: [
          { sender_name: 'Fictional Friend Four', timestamp_ms: ms('2023-01-10T12:00:00Z'), content: 'hm' },
          { sender_name: 'Fictional Friend Four', timestamp_ms: ms('2023-01-11T12:00:00Z'), content: 'ok' },
        ],
      },
    ],
  },
  {
    folder: 'your_instagram_activity/messages/inbox/big_crowd_ghi999',
    files: [
      {
        name: 'message_1.json',
        participants: [...bigGroupOthers, OWNER],
        messages: bigGroupMessages,
      },
    ],
  },
];
const threadMessageTotal = threads.reduce(
  (sum, t) => sum + t.files.reduce((s, f) => s + f.messages.length, 0),
  0
);

// -- expected friend ranking -----------------------------------------------
// Weighted score = thread messageCount / number of OTHER participants,
// summed per person across their threads, with the owner excluded
// entirely. Friend One (a real, two-person friendship) should outrank
// every member of the forty-person group even though the group's raw
// message count (120) dwarfs any single real thread — that is the
// weighting fix working. Computed once here, by hand, so the test is
// checking arithmetic against a fixed expectation, not against whatever
// the code under test happens to produce.
const EXPECTED_FRIEND_SCORES = {
  'Fictional Friend One': 4, // (2021-03-05 + 2021-04-01 by friend, +2 by owner) = 4 msgs / 1 other
  'Fictional Friend Two': 1.5, // 3 msgs (merged across 2 chunk files) / 2 others
  'Fictional Friend Three': 1.5,
  'Fictional Friend Four': 2, // 2 msgs / 1 other
};
bigGroupOthers.forEach((name) => {
  EXPECTED_FRIEND_SCORES[name] = 3; // 120 msgs / 40 others
});
const EXPECTED_TOP_FRIEND = 'Fictional Friend One'; // highest score (4), and not the owner

// -- posts -----------------------------------------------------------------
// Mixes both shapes Meta has shipped: a top-level creation_timestamp, and a
// creation_timestamp nested under media[].
const posts = [
  { caption: 'post one', creation_timestamp: iso('2021-01-01T00:00:00Z') },
  { caption: 'post two', creation_timestamp: iso('2022-02-02T00:00:00Z') },
  { caption: 'post three', media: [{ uri: 'media/three.jpg', creation_timestamp: iso('2023-03-03T00:00:00Z') }] },
  { caption: 'post four', creation_timestamp: iso('2024-04-04T00:00:00Z') },
  { caption: 'post five', creation_timestamp: iso('2025-05-05T00:00:00Z') },
  { caption: 'post six', creation_timestamp: iso('2026-08-30T00:00:00Z') },
];

// -- ads_and_topics ----------------------------------------------------
const adsViewed = [
  { title: 'Fictitious Kettle Co. — sale', author: 'Fictitious Kettle Co.', timestamp: iso('2020-12-25T00:00:00Z') },
  { title: 'Sample Sneaker Outpost — new drop', author: 'Sample Sneaker Outpost', timestamp: iso('2021-07-04T00:00:00Z') },
  { title: 'Imaginary Airlines Ltd — fares', author: 'Imaginary Airlines Ltd', timestamp: iso('2022-11-11T00:00:00Z') },
  { title: 'Faux Furniture Traders — clearance', author: 'Faux Furniture Traders', timestamp: iso('2023-05-05T00:00:00Z') },
];

const topics = ['Topic Sample One', 'Topic Sample Two', 'Topic Sample Three', 'Topic Sample Four', 'Topic Sample Five'];

// -- expected aggregate result --------------------------------------------
// What a correct parser must produce from the archive built from the data
// above. This is the falsifiable contract the test checks.
const EXPECTED = {
  advertiserCount: uniqueAdvertisers.length, // 8
  threadCount: threads.length, // 4
  threadMessageTotal, // 129
  postsCount: posts.length, // 6
  adsAndTopicsEventsCount: adsViewed.length, // 4
  topicsCount: topics.length, // 5
  spanMinIso: '2020-12-25T00:00:00Z', // ads_viewed
  spanMaxIso: '2026-08-30T00:00:00Z', // posts
  owner: OWNER,
};

module.exports = {
  iso,
  ms,
  advertisersFileA,
  advertisersFileB,
  uniqueAdvertisers,
  threads,
  posts,
  adsViewed,
  topics,
  OWNER,
  EXPECTED,
  EXPECTED_FRIEND_SCORES,
  EXPECTED_TOP_FRIEND,
};
