/* Synthetic, non-real data for the Reddit export fixture. Every subreddit,
 * post, and username below is invented for this fixture — no real
 * community or account appears here. Shared by build-fixture.js (which
 * writes the zip) and test/reddit.test.js (which checks the parser
 * against it), so the expected counts and the generated CSV text can never
 * drift apart.
 *
 * Exercises every shape parsers/reddit.js is built to read (posts,
 * comments, post_votes, comment_votes, messages, subscribed_subreddits,
 * saved_posts, saved_comments) — one malformed row in several of them, to
 * prove a bad row is skipped and counted rather than voiding the file —
 * plus a handful of Reddit-named CSVs this parser recognizes but does not
 * open (birthdate.csv, gold_received.csv), and one quoted, multi-line
 * field in posts.csv to exercise the CSV parser's own quote handling.
 */
'use strict';

const iso = (s) => Math.floor(Date.parse(s) / 1000); // epoch seconds

// -- posts.csv -------------------------------------------------------------
// Row 3's date is deliberately unparsable (malformed, skipped and counted).
// Row 4's subreddit is deliberately blank (post still counted; nothing
// added to the subreddit set). Row 1's body is a quoted field containing
// both an embedded comma and an embedded newline, to exercise the CSV
// parser's own RFC 4180 quote handling — real Reddit post/comment bodies
// carry both routinely.
const postsCsv =
  'id,permalink,date,subreddit,title,url,body\n' +
  '"p1","/r/FictionalSubA/comments/p1","2019-03-01T10:15:00.000Z","FictionalSubA","A quoted title, with a comma","https://example.invalid/p1","Line one\nLine two, with a comma inside quotes"\n' +
  'p2,/r/FictionalSubB/comments/p2,2020-07-15T08:30:00.000Z,FictionalSubB,Another fictitious title,https://example.invalid/p2,a short body\n' +
  'p3,/r/FictionalSubA/comments/p3,not-a-real-date,FictionalSubA,Malformed-date row,https://example.invalid/p3,body text\n' +
  'p4,/r/x/comments/p4,2021-11-20T19:45:00.000Z,,Blank-subreddit row,https://example.invalid/p4,body text\n';

// -- comments.csv ------------------------------------------------------
const commentsCsv =
  'id,permalink,date,subreddit,body\n' +
  'c1,/r/FictionalSubC/comments/x/c1,2018-12-25T06:00:00.000Z,FictionalSubC,a fictitious comment\n' +
  'c2,/r/FictionalSubA/comments/x/c2,2022-02-14T21:10:00.000Z,FictionalSubA,another fictitious comment\n';

// -- post_votes.csv — "not listed by date," per Reddit's own description --
// Row 4's direction is deliberately neither "up" nor "down" (malformed).
const postVotesCsv =
  'id,permalink,direction\n' +
  'p10,/r/FictionalSubA/comments/p10,up\n' +
  'p11,/r/FictionalSubB/comments/p11,down\n' +
  'p12,/r/FictionalSubA/comments/p12,up\n' +
  'p13,/r/FictionalSubA/comments/p13,sideways\n';

// -- comment_votes.csv ---------------------------------------------------
const commentVotesCsv =
  'id,permalink,direction\n' +
  'c10,/r/FictionalSubA/comments/x/c10,up\n' +
  'c11,/r/FictionalSubB/comments/x/c11,up\n' +
  'c12,/r/FictionalSubA/comments/x/c12,down\n';

// -- messages.csv — counts (and, where dated, a timestamp) only; from/to/
// subject/body are read by nothing in this parser, even though the header
// row carries them. Row 3's date is deliberately blank.
const messagesCsv =
  'id,permalink,date,from,to,subject,body\n' +
  'm1,/message/messages/m1,2020-01-01T00:00:00.000Z,fictitious_sender_one,fixture_owner,a fictitious subject,"a fictitious message body, never read"\n' +
  'm2,/message/messages/m2,2020-06-01T00:00:00.000Z,fictitious_sender_two,fixture_owner,another fictitious subject,another fictitious body\n' +
  'm3,/message/messages/m3,,fictitious_sender_three,fixture_owner,a third fictitious subject,a third fictitious body\n';

// -- subscribed_subreddits.csv — one new community, one duplicate of a
// posts.csv subreddit (must not double-count), one row that is present but
// carries only whitespace (malformed — skipped and counted, distinct from
// the trailing blank line below it, which is just how the file ends and
// must be ignored without being counted as a skipped record).
const subscribedSubredditsCsv =
  'subreddit\n' +
  'FictionalSubA\n' +
  'FictionalSubD\n' +
  '   \n' +
  '\n';

// -- saved_posts.csv / saved_comments.csv — id/permalink only ------------
const savedPostsCsv = 'id,permalink\n' + 'p20,/r/FictionalSubA/comments/p20\n' + 'p21,/r/FictionalSubB/comments/p21\n';
const savedCommentsCsv = 'id,permalink\n' + 'c20,/r/FictionalSubA/comments/x/c20\n';

// -- Reddit-named CSVs this parser recognizes for detection, but never
// opens for content (out of scope by design — see the file header on why).
const birthdateCsv = 'birthdate\n1990-01-01\n';
const goldReceivedCsv = 'id,date,amount\ng1,2021-01-01T00:00:00.000Z,10\n';

// -- decoy: an unrelated CSV that happens to share a basename Reddit does
// NOT use — must never affect isRedditExport() either way.
const decoyUnrelatedCsv = 'not,a,reddit,file\n1,2,3,4\n';

// -- expected aggregate result ---------------------------------------------
const EXPECTED = {
  postCount: 4,
  commentCount: 2,
  subreddits: ['FictionalSubA', 'FictionalSubB', 'FictionalSubC', 'FictionalSubD'],
  subredditCount: 4,
  postVotes: { up: 2, down: 1, total: 3 },
  commentVotes: { up: 2, down: 1, total: 3 },
  messageCount: 3,
  savedPostCount: 2,
  savedCommentCount: 1,
  spanMinIso: '2018-12-25T06:00:00.000Z', // comments.csv, c1
  spanMaxIso: '2022-02-14T21:10:00.000Z', // comments.csv, c2
  filesScanned: 8,
  filesMatched: 8,
  // 1 (posts.csv, p3's unparsable date) + 1 (post_votes.csv, p13's
  // "sideways" direction) + 1 (subscribed_subreddits.csv's blank row)
  skippedRecords: 3,
};

module.exports = {
  iso,
  postsCsv,
  commentsCsv,
  postVotesCsv,
  commentVotesCsv,
  messagesCsv,
  subscribedSubredditsCsv,
  savedPostsCsv,
  savedCommentsCsv,
  birthdateCsv,
  goldReceivedCsv,
  decoyUnrelatedCsv,
  EXPECTED,
};
