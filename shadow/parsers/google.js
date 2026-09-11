/* We the Users — Shadow instrument
 * Google Takeout data-export parser.
 *
 * Google's export tool ("Takeout") packages one .zip per request, with a
 * `Takeout/` root and a fixed, human-readable set of per-product folder
 * names underneath it ("My Activity", "Location History (Timeline)",
 * "YouTube and YouTube Music", and so on). Detection here checks that
 * shape — the export's own known top-level directory names, matched by
 * exact segment equality — never a bare substring test on a path. That is
 * what keeps a Meta export that happens to mention "Google" or "Takeout"
 * somewhere in a filename from being misrouted here, and what keeps this
 * export from being misrouted to meta.js (see parsers/meta.js's own
 * routing test, and this file's own negative test in test/google.test.js).
 *
 * Deliberately narrow: only the files this parser is built to read are ever
 * opened. Takeout also ships Gmail (as an .mbox), Drive (as native files),
 * and Google Photos (thousands of per-photo sidecar files) in the same
 * archive — none of that is in scope, and none of it is read, because this
 * file's path filter excludes it before a single byte of it is inflated.
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.GoogleParser.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GoogleParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- export detection: the Takeout tree's own shape ----------

  // The product folders Takeout is known to have shipped under its
  // `Takeout/` root, checked against the SECOND path segment only, by exact
  // string equality — never a substring test — so a file that merely
  // mentions one of these words elsewhere in its name cannot match. Not
  // every product here is one this parser reads (Gmail, Drive, and Google
  // Photos are listed so the export is still recognized as a Google Takeout
  // export even when the file dropped is, say, Photos-only — see "Must
  // handle" in the task this file closes: recognizing the export and
  // reading its contents are two different jobs).
  const TAKEOUT_PRODUCT_DIRS = new Set([
    'My Activity',
    'Ads',
    'Location History',
    'Location History (Timeline)',
    'Semantic Location History',
    'YouTube and YouTube Music',
    'Google Photos',
    'Mail',
    'Drive',
    'Search Contributions',
    'Maps',
    'Maps (your places)',
    'Chrome',
    'Calendar',
    'Contacts',
    'Fit',
    'Access Log Activity',
    'Profile',
    'Google Business Profile',
    'Saved',
  ]);

  // ---------- the files this parser actually reads ----------
  //
  // Five known shapes, matched by path — Takeout's own product folder names
  // are the "shape of the tree" the task asks this file to key off, in the
  // same sense meta.js keys off Meta's own top-level directory names. Any
  // file that does not match one of these is never opened by parseArchive()
  // below, which is what keeps Gmail/Drive/Photos out of scope by
  // construction rather than by a promise in a comment.
  const MY_ACTIVITY_RE = /^Takeout\/My Activity\/([^/]+)\/MyActivity\.json$/i;
  const TOP_ADS_RE = /^Takeout\/Ads\/.+\.json$/i;
  const YT_HISTORY_RE = /^Takeout\/YouTube and YouTube Music\/history\/.+\.json$/i;
  const LOCATION_RECORDS_RE = /^Takeout\/Location History(?: \([^)]*\))?\/Records\.json$/i;
  // Google's real layout nests this under the Location History folder —
  // Takeout/Location History/Semantic Location History/<year>/<year>_<MONTH>.json
  // — not at the archive root. Sources, both retrieved 11 September 2026:
  // https://locationhistoryformat.com/guides/general-structure/ (shows
  // exactly that nesting) and https://github.com/purarue/google_takeout_parser
  // (README: "Location History/Semantic Location History/*"). The
  // "(...)" alternate (e.g. "Location History (Timeline)") is kept for the
  // same reason LOCATION_RECORDS_RE keeps it, and the bare-root form is
  // kept too, at no cost, for any older export that used it.
  const SEMANTIC_LOCATION_RE =
    /^Takeout\/(?:Location History(?: \([^)]*\))?\/)?Semantic Location History\/.+\.json$/i;

  const RELEVANT_PATH_RES = [
    MY_ACTIVITY_RE,
    TOP_ADS_RE,
    YT_HISTORY_RE,
    LOCATION_RECORDS_RE,
    SEMANTIC_LOCATION_RE,
  ];

  function looksRelevantByPath(name) {
    return RELEVANT_PATH_RES.some((re) => re.test(name));
  }

  // ---------- HTML-format Takeout detection (Costly item C3) ----------
  //
  // Takeout offers History exports as HTML or JSON; an HTML export routes
  // here (the product-folder names and archive_browser.html are still
  // present) but matches none of the five JSON shapes above, so it reads
  // as "found nothing" rather than "wrong format." These two path shapes —
  // an HTML file sitting exactly where a matched JSON file would be — are
  // enough to tell the two apart without opening any file content.
  const MY_ACTIVITY_HTML_RE = /^Takeout\/My Activity\/[^/]+\/MyActivity\.html$/i;
  const YT_HISTORY_HTML_RE = /^Takeout\/YouTube and YouTube Music\/history\/.+\.html$/i;
  function looksLikeHtmlExport(names) {
    return names.some((n) => MY_ACTIVITY_HTML_RE.test(n) || YT_HISTORY_HTML_RE.test(n));
  }

  function topLevelDir(name) {
    const i = name.indexOf('/');
    return i === -1 ? name : name.slice(0, i);
  }

  function secondLevelDir(name) {
    const parts = name.split('/');
    return parts.length > 1 ? parts[1] : null;
  }

  // Cheap pre-check over a file-name list, used by the page to decide
  // whether to route a zip through this parser at all. Two independent
  // structural signals: one of the five known file shapes above, or an
  // exact match on the export's own root ("Takeout") plus one of its known
  // product folder names as the second path segment. Either is sufficient;
  // neither is a substring test on the whole path.
  function isGoogleExport(names) {
    if (names.some((n) => looksRelevantByPath(n))) return true;
    for (const n of names) {
      if (topLevelDir(n) === 'Takeout') {
        const second = secondLevelDir(n);
        if (second && TAKEOUT_PRODUCT_DIRS.has(second)) return true;
      }
    }
    // Takeout writes its own manifest at the archive root — a reliable
    // signal even for a request that bundled only products this parser
    // does not read (e.g. Photos-only).
    if (names.includes('Takeout/archive_browser.html')) return true;
    return false;
  }

  // ---------- helpers ----------

  function toSecondsFromISO(v) {
    if (typeof v !== 'string') return null;
    const ms = Date.parse(v);
    if (isNaN(ms)) return null;
    return Math.floor(ms / 1000);
  }

  function toSecondsFromMsString(v) {
    const n = Number(v);
    if (!isFinite(n)) return null;
    return Math.floor(n / 1000);
  }

  function plausibleSeconds(s) {
    return s > 946684800 && s < 4102444800; // year 2000 .. year 2100
  }

  function dayKey(s) {
    // UTC calendar date, not local time — deterministic regardless of the
    // machine running this code, and matches how Takeout itself timestamps
    // everything (UTC ISO strings, or ms-since-epoch).
    return new Date(s * 1000).toISOString().slice(0, 10);
  }

  // ---------- shape detectors ----------

  // My Activity/<Product>/MyActivity.json, the top-level Ads/*.json form,
  // and the YouTube-history files all share one shape: an array of records,
  // each normally carrying an ISO-8601 "time" string. A real export can
  // still carry the occasional malformed row (a null time, a record that
  // isn't an object) without the file itself being some other shape
  // entirely — so this checks a sample, not every row, and tolerates a
  // minority being off-shape (Costly C2: previously one bad record voided
  // the whole file, silently zeroing the biggest finding on the page).
  // classify() below still skips — and counts — any row that fails the
  // per-record check, whichever file shape matched.
  function isActivityArray(j) {
    if (!Array.isArray(j) || !j.length) return false;
    const probe = j.slice(0, 50);
    const timed = probe.filter((it) => it && typeof it === 'object' && typeof it.time === 'string').length;
    return timed >= Math.ceil(probe.length * 0.8);
  }

  // Google's Ads activity entries name the advertiser inside a `subtitles`
  // array ({name, url}) — the same field My Activity uses everywhere to
  // attribute an entry to an external page, channel, or, for Ads
  // specifically, the advertiser itself. Only trusted when the record's own
  // header (or its products list) says Ads, so an unrelated "By <someone>"
  // subtitle from another product is never mistaken for an advertiser.
  function extractAdvertiser(record) {
    if (!record || typeof record !== 'object') return null;
    const isAds = record.header === 'Ads' || (Array.isArray(record.products) && record.products.includes('Ads'));
    if (!isAds) return null;
    if (Array.isArray(record.subtitles)) {
      const s = record.subtitles.find((x) => x && typeof x.name === 'string' && x.name.trim());
      if (s) return s.name.trim();
    }
    return null;
  }

  // Location History/Records.json: `{ locations: [ {...}, ... ] }`. Google
  // has shipped both a `timestampMs` string field (older exports) and a
  // `timestamp` ISO string (newer ones) on the same record shape — both are
  // read here, never assumed to be the only one in a given file.
  function findLocationRecordsArray(j) {
    if (j && typeof j === 'object' && Array.isArray(j.locations)) return j.locations;
    return null;
  }

  function locationRecordTimestamp(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (typeof rec.timestamp === 'string') return toSecondsFromISO(rec.timestamp);
    if (rec.timestampMs != null) return toSecondsFromMsString(rec.timestampMs);
    return null;
  }

  // Semantic Location History/<year>/<year>_<MONTH>.json:
  // `{ timelineObjects: [ {placeVisit: {...}} | {activitySegment: {...}}, ... ] }`,
  // each carrying a `duration.startTimestamp` (ISO) or, in older exports,
  // `duration.startTimestampMs`.
  function findTimelineObjectsArray(j) {
    if (j && typeof j === 'object' && Array.isArray(j.timelineObjects)) return j.timelineObjects;
    return null;
  }

  function timelineObjectTimestamp(obj) {
    const seg = obj && (obj.placeVisit || obj.activitySegment);
    const dur = seg && seg.duration;
    if (!dur) return null;
    if (typeof dur.startTimestamp === 'string') return toSecondsFromISO(dur.startTimestamp);
    if (dur.startTimestampMs != null) return toSecondsFromMsString(dur.startTimestampMs);
    return null;
  }

  // ---------- classification ----------

  function classify(name, j, out) {
    let matched = false;

    const myActivityMatch = name.match(MY_ACTIVITY_RE);
    const isTopAdsFile = TOP_ADS_RE.test(name);
    const isYouTubeHistoryFile = YT_HISTORY_RE.test(name);

    if ((myActivityMatch || isTopAdsFile || isYouTubeHistoryFile) && isActivityArray(j)) {
      const product = myActivityMatch ? myActivityMatch[1] : isYouTubeHistoryFile ? 'YouTube' : 'Ads';
      out.products.add(product);
      j.forEach((rec) => {
        // A malformed row (not an object, or no "time" string) is skipped
        // and counted, not treated as a reason to drop the file — see
        // isActivityArray() above.
        if (!rec || typeof rec !== 'object' || typeof rec.time !== 'string') {
          out.skippedRecords++;
          return;
        }
        out.eventCount++;
        const s = toSecondsFromISO(rec.time);
        if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
        const adv = extractAdvertiser(rec);
        if (adv) out.advertisers.push(adv);
      });
      matched = true;
    }

    if (LOCATION_RECORDS_RE.test(name)) {
      const locations = findLocationRecordsArray(j);
      if (locations) {
        locations.forEach((rec) => {
          const s = locationRecordTimestamp(rec);
          if (s != null && plausibleSeconds(s)) {
            out.timestamps.push(s);
            out.locationDays.add(dayKey(s));
          }
        });
        matched = true;
      }
    }

    if (SEMANTIC_LOCATION_RE.test(name)) {
      const timeline = findTimelineObjectsArray(j);
      if (timeline) {
        timeline.forEach((obj) => {
          const s = timelineObjectTimestamp(obj);
          if (s != null && plausibleSeconds(s)) {
            out.timestamps.push(s);
            out.locationDays.add(dayKey(s));
          }
        });
        matched = true;
      }
    }

    return matched;
  }

  // ---------- entry points ----------

  function makeOut() {
    return {
      products: new Set(),
      eventCount: 0,
      advertisers: [],
      timestamps: [],
      locationDays: new Set(),
      filesScanned: 0,
      filesMatched: 0,
      skippedRecords: 0,
    };
  }

  // Shared by parseFromEntries() and parseArchive()'s streaming loop below,
  // so both entry points produce the exact same result shape from the same
  // running totals: dedupe products/advertisers, collapse the day-set to a
  // count, and compute the timestamp span with a loop rather than
  // Math.min(...arr)/Math.max(...arr) — spreading an array into a function
  // call is bounded by V8's call-stack argument limit (meta.js measured:
  // fine at 124,000 elements, RangeError at 125,000; the same limit applies
  // here, and Location History alone can ship hundreds of thousands of
  // points for an active account).
  function finalize(out) {
    out.advertisers = [...new Set(out.advertisers)];
    out.products = [...out.products];
    out.locationDays = out.locationDays.size;

    if (out.timestamps.length) {
      let mn = Infinity, mx = -Infinity;
      for (const t of out.timestamps) {
        if (t < mn) mn = t;
        if (t > mx) mx = t;
      }
      out.span = { min: mn, max: mx };
    } else {
      out.span = null;
    }

    return out;
  }

  // fileEntries: [{name, text}] — already-read strings. Kept separate from
  // ZIP I/O so this function is pure and trivial to unit test, same as
  // meta.js's parseFromEntries().
  function parseFromEntries(fileEntries) {
    const out = makeOut();

    fileEntries.forEach((f) => {
      // Files outside the five known shapes are never even parsed — this is
      // the "do not attempt Gmail or Drive contents" boundary, enforced
      // structurally rather than by convention.
      if (!looksRelevantByPath(f.name)) return;
      out.filesScanned++;
      let j;
      try {
        j = JSON.parse(f.text);
      } catch (e) {
        return;
      }
      if (classify(f.name, j, out)) out.filesMatched++;
    });

    return finalize(out);
  }

  // ---------- size caps, checked BEFORE inflation ----------
  //
  // Identical values to meta.js's SIZE_CAPS, for the same reasons (see that
  // file's comment) — kept as a separate constant here, not imported, so
  // this module stays self-contained and loads in either order. If these
  // two files' caps are ever changed, change both.
  const SIZE_CAPS = {
    PER_FILE_BYTES: 50 * 1024 * 1024,
    TOTAL_BYTES: 500 * 1024 * 1024,
  };

  function SizeCapError(message) {
    const e = new Error(message);
    e.code = 'SIZE_CAP_EXCEEDED';
    return e;
  }

  // Same technique as meta.js: read JSZip's own declared-size field from the
  // zip's central directory, before any inflation. See meta.js's identical
  // function for the full reasoning.
  function declaredSize(entry) {
    const d = entry && entry._data;
    return d && typeof d.uncompressedSize === 'number' ? d.uncompressedSize : null;
  }

  function sleep0() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // zip: a JSZip instance. opts.onProgress(done, total) — called as entries
  // are processed. opts.yieldEvery (default 25) — after this many entries,
  // the loop awaits a zero-delay timeout so a big archive does not freeze
  // the tab between chunks. Only the five known Takeout paths are ever
  // enumerated, let alone inflated — a Takeout archive can easily carry
  // Gmail/Drive/Photos content orders of magnitude larger than the files
  // this parser reads, and none of it is opened.
  //
  // Each entry is parsed and classified as soon as its text is read, then
  // discarded — never collected into an array of every file's full text
  // first (Costly C5: on a single 50 MB Records.json, holding the text
  // alongside its own parse doubled peak heap for no reason). Only the
  // running totals in `out` persist across files.
  //
  // An entry whose declared size is over the per-file cap is refused
  // before inflation, same as before — but now recorded in `skipped`
  // rather than silently dropped, so the caller can say what was skipped
  // and how large it was (Costly C1) instead of the page reporting zero
  // with no explanation.
  async function parseArchive(zip, opts) {
    const options = opts || {};
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    const yieldEvery = options.yieldEvery || 25;

    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const relevantNames = names.filter((n) => looksRelevantByPath(n));

    const out = makeOut();
    const skipped = [];
    let totalDeclared = 0;
    let processed = 0;
    for (const name of relevantNames) {
      const entry = zip.files[name];
      const size = declaredSize(entry);

      if (size != null && size > SIZE_CAPS.PER_FILE_BYTES) {
        skipped.push({ name, bytes: size });
        processed++;
        onProgress(processed, relevantNames.length);
        continue;
      }

      if (size != null) {
        totalDeclared += size;
        if (totalDeclared > SIZE_CAPS.TOTAL_BYTES) {
          throw SizeCapError(
            'This archive declares more data than this tool will read in one go ' +
              '(over ' + Math.round(SIZE_CAPS.TOTAL_BYTES / (1024 * 1024)) + ' MB uncompressed). ' +
              'Stopped before reading the rest, so nothing past this point was opened.'
          );
        }
      }

      let text;
      try {
        text = await entry.async('string');
      } catch (e) {
        processed++;
        onProgress(processed, relevantNames.length);
        continue;
      }

      out.filesScanned++;
      try {
        const j = JSON.parse(text);
        if (classify(name, j, out)) out.filesMatched++;
      } catch (e) {
        // Not valid JSON — scanned, but not matched. text goes out of
        // scope here; nothing about this file is retained past this point.
      }

      processed++;
      onProgress(processed, relevantNames.length);
      if (processed % yieldEvery === 0) await sleep0();
    }
    const result = finalize(out);
    result.skipped = skipped;
    return result;
  }

  return {
    isGoogleExport,
    looksLikeHtmlExport,
    parseArchive,
    parseFromEntries,
    SIZE_CAPS,
    _internal: {
      toSecondsFromISO,
      toSecondsFromMsString,
      plausibleSeconds,
      declaredSize,
      dayKey,
      looksRelevantByPath,
    },
  };
});
