/* We the Users — Shadow instrument
 * Findings for the Reddit parser (parsers/reddit.js).
 *
 * Wired into index.html's render() pipeline (see harvestReddit() there).
 * Same shape harvestGoogle()/render() use: an array of { v, h, p, tags? }
 * objects — v a short label, h a headline built from real computed
 * numbers, p a paragraph.
 *
 * Every `h` below is built from a number this file actually computed from
 * the parser's output. Every `p` states what a number means, checked
 * sentence-by-sentence against what parsers/reddit.js actually computes —
 * in particular the note there on how the CSV header shapes used for
 * detection were sourced (Reddit's own page confirms file names only; the
 * column names come from a third-party tool, not Reddit itself).
 *
 * Works two ways: browser <script> sets window.RedditFindings; Node
 * exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RedditFindings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // A span under ~18 days rounds to "0.0 years" under (seconds/31557600)
  // .toFixed(1) — a real number that reads as no time having passed at
  // all. Below that threshold this reports whole days instead (same fix
  // as apple.findings.js's fmtSpan()).
  function fmtSpan(seconds) {
    const yrs = Number((seconds / 31557600).toFixed(1));
    if (yrs > 0) return `${yrs.toLocaleString()} ${yrs === 1 ? 'year' : 'years'}`;
    const days = Math.max(1, Math.round(seconds / 86400));
    return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`;
  }

  // r: the object RedditParser.parseArchive()/parseFromEntries() returns.
  function buildFindings(r) {
    const F = [];
    if (!r) return F;

    // 1 — the span, from posts and comments only. Message dates never enter
    // this: parsers/reddit.js's messages.csv branch counts messages but
    // never pushes a message's date into the pooled timestamp list this
    // span is computed from — see that file's own comment. A private
    // message years older or newer than everything you ever posted must
    // never be the thing that sets this headline's number.
    const N = r.postCount + r.commentCount;
    if (r.span && N > 8) {
      const spanLabel = fmtSpan(r.span.max - r.span.min);
      F.push({
        v: 'The span',
        h: `${spanLabel}, ${N.toLocaleString()} posts and comments.`,
        p: `Posts and comments filed years apart, under different subreddits, pool into one continuous record the moment they are read together — not because Reddit built a timeline, but because every one of them carries your account and a date. What looked like scattered, forgettable activity turns out to have been kept, completely, the whole time.`,
      });
    }

    // 2 — the subreddits: where you actually spent your attention, pooled
    // from subscriptions, posts, and comments.
    if (r.subreddits.length > 0) {
      F.push({
        v: 'The subreddits',
        h: `${r.subreddits.length.toLocaleString()} communit${r.subreddits.length === 1 ? 'y' : 'ies'}.`,
        p: `This list pools three things into one: subreddits you subscribed to, posted in, and commented in, with no record kept of which one applies to a given name. Even pooled that way, a subreddit list reads unusually directly — health conditions, politics, hobbies, and circumstances people rarely state outright are often written right into the community's name.`,
        tags: r.subreddits.slice(0, 26),
      });
    }

    // 3 — voting: post_votes.csv and comment_votes.csv are, by Reddit's own
    // description, "not listed by date" — so this can only ever be a
    // total, never a rhythm or a span.
    const voteTotal = r.postVotes.total + r.commentVotes.total;
    if (voteTotal > 0) {
      F.push({
        v: 'The votes',
        h: `${voteTotal.toLocaleString()} vote${voteTotal === 1 ? '' : 's'} cast (${r.postVotes.total.toLocaleString()} on posts, ${r.commentVotes.total.toLocaleString()} on comments).`,
        p: `Reddit's own export does not date-stamp a vote, so this can only ever be a total — not a timeline, and no evidence of when any of it happened. What it does show plainly is the split: how much of your activity here was posting and commenting, in your own words, against how much was a button pressed in passing.`,
      });
    }

    // 4 — messages: counts only, never content.
    if (r.messageCount > 0) {
      F.push({
        v: 'The messages',
        h: `${r.messageCount.toLocaleString()} private message${r.messageCount === 1 ? '' : 's'}.`,
        p: `Only the count was read here — never the date, never who a message was with, never a word of what it said, though the file makes all three readable.`,
      });
    }

    // 5 — saved items.
    const savedTotal = r.savedPostCount + r.savedCommentCount;
    if (savedTotal > 0) {
      F.push({
        v: 'The saved',
        h: `${savedTotal.toLocaleString()} item${savedTotal === 1 ? '' : 's'} saved for later (${r.savedPostCount.toLocaleString()} post${r.savedPostCount === 1 ? '' : 's'}, ${r.savedCommentCount.toLocaleString()} comment${r.savedCommentCount === 1 ? '' : 's'}).`,
        p: `Saving something on Reddit leaves no public trace — unlike a vote, a post, or a comment, nobody else can see that you did it. This list doesn't say whether you also posted, voted on, or commented on the same thing elsewhere; saved_posts.csv and saved_comments.csv are never cross-checked against those files here. It is the one list on this page built from private attention alone.`,
      });
    }

    return F;
  }

  return { buildFindings, esc, _internal: { fmtSpan } };
});
