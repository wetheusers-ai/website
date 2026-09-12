/* We the Users — Shadow instrument
 * Findings for the X (Twitter) parser (parsers/x.js).
 *
 * Wired into index.html's render() pipeline (see harvestX() there). Same
 * shape harvestGoogle()/render() use: an array of { v, h, p, tags? }
 * objects — v a short label, h a headline built from real computed
 * numbers, p a paragraph.
 *
 * Every `h` below is built from a number this file actually computed from
 * the parser's output — nothing invented. Every `p` states what a number
 * means, checked sentence-by-sentence against what parsers/x.js actually
 * computes — most of the same caveats google.js's own findings in
 * index.html already carry apply again here (see render()'s "The list"
 * finding for Google, for the shape a careful caveat takes).
 *
 * Works two ways: browser <script> sets window.XFindings; Node exports the
 * same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XFindings = factory();
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

  // r: the object XParser.parseArchive()/parseFromEntries() returns.
  function buildFindings(r) {
    const F = [];
    if (!r) return F;

    // 1 — the span (tweets only; like.js carries no timestamp — see
    // parsers/x.js's file header).
    if (r.span && r.tweetCount > 8) {
      const spanLabel = fmtSpan(r.span.max - r.span.min);
      F.push({
        v: 'The span',
        h: `${spanLabel}, ${r.tweetCount.toLocaleString()} posts.`,
        p: `Every post you made in public on X now sits on one continuous timeline instead of scattered across years of scrolling. Nothing here was hidden from you — you posted or reposted every line — but no one meant for it to be read back as a single, dated record until it was requested as one.`,
      });
    }

    // 2 — likes.
    if (r.likeCount > 0) {
      F.push({
        v: 'The likes',
        h: `${r.likeCount.toLocaleString()} post${r.likeCount === 1 ? '' : 's'} liked.`,
        p: `A like carries no date in this file — X's own export does not stamp one — so this is a single total, not a timeline: everything you have ever liked, added up, with no way to say when. Even without dates, the list is still a plain record of what held your attention, post by post.`,
      });
    }

    // 3 — direct messages: counts only, never content.
    if (r.dmConversationCount > 0 || r.dmMessageCount > 0) {
      F.push({
        v: 'The messages',
        h: `${r.dmConversationCount.toLocaleString()} conversation${r.dmConversationCount === 1 ? '' : 's'}, ${r.dmMessageCount.toLocaleString()} message${r.dmMessageCount === 1 ? '' : 's'}.`,
        p: `This counts conversations and messages only — never who they were with, never a word of what was said. That is a deliberate limit, not a technical one: the archive makes both readable, and this page reads past them to the count and stops.`,
      });
    }

    // 4 — advertisers, split by mechanism (an impression is an ad shown; an
    // engagement is an ad interacted with — these are not the same claim,
    // so they are not merged into one number).
    const impressionNames = Object.keys(r.adImpressionCounts || {});
    const engagementNames = Object.keys(r.adEngagementCounts || {});
    const impressionTotal = impressionNames.reduce((s, n) => s + r.adImpressionCounts[n], 0);
    const engagementTotal = engagementNames.reduce((s, n) => s + r.adEngagementCounts[n], 0);
    if (impressionNames.length) {
      F.push({
        v: 'The impressions',
        h: `${impressionNames.length.toLocaleString()} advertiser${impressionNames.length === 1 ? '' : 's'}, ${impressionTotal.toLocaleString()} logged impression${impressionTotal === 1 ? '' : 's'}.`,
        p: `Each name here is an advertiser X logged as having shown you an ad — not a claim that the advertiser targeted you by name, and not a claim any of them hold your contact details. X's own export does not say why an advertiser reached you, only that, at least once, one of their ads did.`,
        tags: impressionNames.slice(0, 26),
      });
    }
    if (engagementNames.length) {
      // "The count is smaller than the impressions above" is only true, and
      // only makes sense to say, when an impressions card is actually on
      // screen above this one and its total really is larger — X's own
      // impressions window can be shorter than its engagements window, so
      // neither half of that clause can be assumed.
      const canCompare = impressionNames.length > 0 && impressionTotal > engagementTotal;
      F.push({
        v: 'The engagements',
        h: `${engagementNames.length.toLocaleString()} advertiser${engagementNames.length === 1 ? '' : 's'}, ${engagementTotal.toLocaleString()} logged engagement${engagementTotal === 1 ? '' : 's'}.`,
        p: `An engagement is a step past an impression: an ad you tapped, clicked, or otherwise acted on, not one that merely loaded in front of you.${canCompare ? ' The count is smaller than the impressions above for that reason' : ' It marks a deliberate action'} — not just a screen an ad happened to appear on.`,
        tags: engagementNames.slice(0, 26),
      });
    }

    return F;
  }

  return { buildFindings, esc, _internal: { fmtSpan } };
});
