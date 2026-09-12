/* We the Users — Shadow instrument
 * Turns an AppleParser result (parsers/apple.js's parseArchive()/
 * parseFromEntries() output) into finding cards — the same {v, h, p, tags}
 * shape index.html's render() builds its `F` array from for Google and the
 * generic path (see index.html's "FINDINGS" section, and harvestGoogle()
 * just above it).
 *
 * Split into its own file rather than added inline in index.html so each
 * platform's findings logic (Apple, X, Reddit — see the sibling
 * *.findings.js files) stays independently readable and testable. Every
 * `v` here is a short, factual, structural label — matching the existing
 * taxonomy ("The span", "The trail", "The products") — and every `h`
 * states only a real, computed number, with no interpretation added.
 * Every `p` states what a number means, checked sentence-by-sentence
 * against what parsers/apple.js actually computes.
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.AppleFindings.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.AppleFindings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fmtHour(n) {
    return (n % 12 === 0 ? 12 : n % 12) + (n < 12 ? 'am' : 'pm');
  }

  // A span under ~18 days rounds to "0.0 years" under (seconds/31557600)
  // .toFixed(1) — a real number that reads as no time having passed at
  // all. Below that threshold this reports whole days instead, never a
  // year figure that displays as zero.
  function fmtSpan(seconds) {
    const yrs = Number((seconds / 31557600).toFixed(1));
    if (yrs > 0) return `${yrs.toLocaleString()} ${yrs === 1 ? 'year' : 'years'}`;
    const days = Math.max(1, Math.round(seconds / 86400));
    return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`;
  }

  // Same histogram-and-peak method render()'s "the rhythm" finding uses for
  // Google/Meta/generic exports (index.html, "2 — the rhythm") — computed
  // here from the parser's own pooled timestamps so this file needs
  // nothing render() doesn't already have.
  function peakHour(timestamps) {
    const h = new Array(24).fill(0);
    timestamps.forEach((t) => h[new Date(t * 1000).getHours()]++);
    let mx = -1, peak = 0;
    for (let i = 0; i < 24; i++) {
      if (h[i] > mx) {
        mx = h[i];
        peak = i;
      }
    }
    return { hour: peak, histogram: h };
  }

  // result: the object AppleParser.parseArchive()/parseFromEntries()
  // returns — {services, eventCount, timestamps, locationDays, span,
  // filesScanned, filesMatched, skippedRecords[, skipped]}.
  function buildFindings(result) {
    const F = [];
    const r = result || {};
    const events = Array.isArray(r.timestamps) ? r.timestamps : [];
    const eventCount = typeof r.eventCount === 'number' ? r.eventCount : events.length;

    // 1 — the span. Same >8-events threshold render()'s own "the span"
    // finding uses, so a near-empty export does not print a span of one day.
    // The paragraph names no fixed list of systems — an export that turned
    // up only one or two of the four documented categories (see the trail
    // finding below for a worked example) must not be told it holds all
    // four.
    if (r.span && eventCount > 8) {
      const spanSeconds = r.span.max - r.span.min;
      const spanLabel = fmtSpan(spanSeconds);
      F.push({
        v: 'The span',
        h: `${spanLabel}, ${eventCount.toLocaleString()} recorded events.`,
        p: `None of the systems behind this file were built to keep a chronicle of you. Strung together by timestamp, that is what they add up to: ordinary use, on one continuous line, under one account.`,
      });
    }

    // 2 — the rhythm. Same >40-events threshold as render()'s own version.
    // The paragraph used to name a fixed four-system list (App Store
    // downloads, media plays, sign-ins, iCloud file activity) regardless of
    // what the export actually held — on a one-service export that read as
    // a claim about systems this file never touched. It now names only
    // r.services, the same list "the services" finding above prints, so a
    // narrow export gets a narrow sentence rather than one implying
    // coverage it doesn't have.
    if (eventCount > 40 && events.length) {
      const { hour } = peakHour(events);
      const svc = Array.isArray(r.services) ? r.services : [];
      const svcList = svc.length > 1
        ? `${svc.slice(0, -1).join(', ')} and ${svc[svc.length - 1]}`
        : svc[0];
      F.push({
        v: 'The rhythm',
        h: `Most active near ${fmtHour(hour)}.`,
        p: `The peak hour comes from every timestamp in the file${svcList ? ` — ${svcList}` : ''} — pooled and counted by hour of day. It says nothing about what you were doing then, only that the account was active, which across enough days is a fair guess at when you are awake.`,
      });
    }

    // 3 — the services. Apple's analogue to Google's "the products" finding
    // (index.html, "3b — the products"): names what was actually found,
    // never implies the export held only these four things.
    if (r.services && r.services.length) {
      const names = r.services;
      const many = names.length > 1;
      const list = many ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      F.push({
        v: 'The services',
        h: `${list}, in one export.`,
        p: `${many ? 'Each of these is a different system inside Apple, built for a different job' : 'This is one system inside Apple'}. ${many ? 'They arrive' : 'It arrives'} here in one downloadable file, because ${many ? 'they were' : 'it was'} always tied to the same account — the request just makes that visible.`,
        tags: names,
      });
    }

    // 4 — the trail. Apple's analogue to Google's "the trail" finding
    // (index.html, "3c — the trail"), but sourced from sign-in records, not
    // a location-history product Apple's own portal does not export the
    // way Google's Takeout does — the headline says where the day-count
    // comes from rather than implying a movement history.
    if (r.locationDays) {
      F.push({
        v: 'The trail',
        h: `${r.locationDays.toLocaleString()} day${r.locationDays === 1 ? ' carries' : 's carry'} a sign-in location.`,
        p: `A day counts only when a sign-in record that day happened to carry a city or region field — this is Apple's own sign-in log, not a location history, and it shows where Apple recorded a sign-in, not everywhere you actually signed in or went. It cannot connect one day's location to the next; it only marks the days on which one particular kind of record happened to include a place. No other category in this file — App Store activity, media purchases, iCloud Drive — is ever read for a location, even where one of those files happens to carry a field with a location-shaped name.`,
      });
    }

    return F;
  }

  return {
    buildFindings,
    _internal: { fmtHour, peakHour, fmtSpan },
  };
});
