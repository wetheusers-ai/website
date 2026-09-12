/* We the Users — Shadow instrument
 * X (Twitter) data-archive parser.
 *
 * X's archive ships a `data/` folder of `.js` files, each one a single
 * JavaScript statement — `window.YTD.<name>.partN = [ ... ];` — wrapping a
 * JSON array. That wrapper, not the filename, is what this parser trusts:
 * every file is opened and its content checked against
 * `window.YTD.<name>.partN =` before anything inside it is treated as data,
 * so a file that merely sits at a path named `tweets.js` in some unrelated
 * export is never mistaken for one (the routing negative in test/x.test.js
 * checks this both ways, against the Meta and Google fixtures). The `<name>`
 * captured out of that wrapper is also what decides WHICH of the six known
 * shapes below a file is — again content, never the filename on disk.
 *
 * The six files this parser reads, and what it does with each — all six
 * are named in the task this file closes:
 *   - tweets.js             — count, and a timestamp for the span.
 *   - like.js                — count only (X's own export carries no
 *                              timestamp on a like; there is nothing to add
 *                              to the span).
 *   - direct-messages.js     — counts only: conversations, and messages
 *                              within them. The message text, and who a
 *                              conversation is with, are never read.
 *   - ad-impressions.js      — the advertiser named on each logged
 *                              impression, and how many times each name
 *                              recurs.
 *   - ad-engagements.js      — the same, for engagements.
 *   - account.js             — identifies the archive's owner (username,
 *                              display name), so a future ranking built on
 *                              top of this parser has something to exclude.
 *              This parser computes no ranking itself — direct-messages.js
 *              is read for counts only, never for who a conversation is
 *              with — so nothing here excludes the owner today. account.js
 *              is still read and `out.owner` still reported, because the
 *              task this file closes names it for exactly that purpose, and
 *              because reporting it costs nothing extra once account.js is
 *              already open.
 *
 * Every other file X's archive ships (profile media, the archive's own
 * `Your archive.html`, `assets/`, follower/following lists, and every other
 * `data/*.js` file this parser was not asked to read) is never opened —
 * `looksRelevantByPath()` below is the pre-filter that keeps this true even
 * before the content check runs.
 *
 * Advertiser-name field: X's own archive documentation does not publish a
 * field-by-field schema for ad-impressions.js/ad-engagements.js. The array
 * path this parser reads — `ad.adsUserData.adImpressions.impressions` /
 * `ad.adsUserData.adEngagements.engagements` — is confirmed by
 * github.com/alkihis/twitter-archive-reader's own file-to-structure map
 * (Files_to_structures.md, retrieved 12 September 2026: "Every
 * ad.adsUserData.adImpressions.impressions array in file is merged into
 * archive.ads.impressions" / the equivalent line for engagements). The
 * per-impression advertiser-name field itself is read defensively, from
 * several plausible key names (see extractAdvertiserName() below), and a
 * record that carries none of them is skipped and counted rather than
 * guessed at.
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.XParser.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- fast route (optimization only, never load-bearing) ----------
  //
  // A cheap pre-filter over the file-name list, used only to decide which
  // entries are worth reading at all — never used to decide what a file
  // IS. That decision is made in classify() below, from the file's own
  // `window.YTD.<name>.partN =` wrapper, once the file is open.
  const YTD_PATH_HINT_RE = /(^|\/)data\/[a-z0-9_-]+\.js$/i;

  function looksRelevantByPath(name) {
    return YTD_PATH_HINT_RE.test(name);
  }

  // The authoritative shape check: every YTD data file is one JS statement
  // assigning a JSON value to `window.YTD.<name>.part<N>`. Captured here as
  // a regex, not a substring test, so a file that merely CONTAINS the text
  // "window.YTD" somewhere inside a larger, unrelated JS or JSON file does
  // not match — the wrapper must be the start of the assignment.
  const YTD_WRAPPER_RE = /^\s*window\.YTD\.([A-Za-z0-9_]+)\.part(\d+)\s*=\s*/;

  // Strips the `window.YTD.<name>.partN = ` wrapper and a trailing
  // semicolon (if present), and parses what is left as JSON. Returns
  // { key, value } on success, or null if the text never had the wrapper in
  // the first place, or what follows it is not valid JSON — either way,
  // "not a YTD file," not a thrown error.
  function parseYtdFile(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(YTD_WRAPPER_RE);
    if (!m) return null;
    let body = text.slice(m[0].length).trim();
    if (body.endsWith(';')) body = body.slice(0, -1).trim();
    let value;
    try {
      value = JSON.parse(body);
    } catch (e) {
      return null;
    }
    return { key: m[1], value };
  }

  // Cheap, path-only pre-check — the same role isGoogleExport()/
  // isMetaExport() play for those parsers: whether it is worth handing this
  // archive to isXExport() at all. Not load-bearing on its own.
  function looksLikeXArchiveByPath(names) {
    return names.some((n) => looksRelevantByPath(n));
  }

  // The real detector. Unlike Google/Meta, X ships no export-specific
  // top-level directory name to key off — "data/" is generic enough that a
  // filename-only check would be a guess, which is exactly what the task
  // this file closes says not to do ("Detect by that window.YTD shape, not
  // by filename alone"). So this peeks at the actual content of a small
  // number of path-plausible candidates and looks for the wrapper itself.
  // Declared size is checked first (same cap as parseArchive, before any
  // inflation) so a detection pass can never be tricked into inflating a
  // huge decoy file.
  async function isXExport(zip, names) {
    if (!zip || !zip.files) return false;
    const candidates = names.filter((n) => looksRelevantByPath(n));
    if (!candidates.length) return false;
    // account.js is the smallest real YTD file and, on a genuine archive,
    // is always present — checked first for speed, but every candidate is
    // tried, so an archive missing account.js (a partial or redacted
    // export) is still detected from whichever YTD file it does carry.
    candidates.sort((a, b) => (/account\.js$/i.test(a) ? -1 : /account\.js$/i.test(b) ? 1 : 0));
    for (const name of candidates.slice(0, 8)) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      const size = declaredSize(entry);
      if (size != null && size > SIZE_CAPS.PER_FILE_BYTES) continue;
      let text;
      try {
        text = await entry.async('string');
      } catch (e) {
        continue;
      }
      if (YTD_WRAPPER_RE.test(text)) return true;
    }
    return false;
  }

  // ---------- helpers ----------

  // Twitter/X has stamped createdAt two ways across the life of this
  // format: an ISO-8601 string (account.js's createdAt, and most others),
  // and tweets.js's own "Wed Oct 10 20:19:24 +0000 2018" form — which
  // JavaScript's Date parser accepts natively (it is the same shape
  // Date#toString() itself produces), so both are handled by the one
  // Date.parse() call rather than two separate formats to maintain.
  function toSecondsFromDateString(v) {
    if (typeof v !== 'string' || !v.trim()) return null;
    const ms = Date.parse(v);
    if (isNaN(ms)) return null;
    return Math.floor(ms / 1000);
  }

  function plausibleSeconds(s) {
    return s > 946684800 && s < 4102444800; // year 2000 .. year 2100
  }

  // Reads an advertiser name defensively, from several plausible key names.
  // The documented shape — alkihis/twitter-archive-reader's GDPRAds.d.ts,
  // package 7.3.3, retrieved 12 September 2026, which this file's header
  // cites for the array path itself — nests it under
  // `impressionAttributes.advertiserInfo.advertiserName`; that is checked
  // first. The flatter `rec.advertiserInfo`/`rec.advertiserName` shape this
  // parser originally targeted is kept too, since neither X's own archive
  // documentation nor a second independent source confirms one shape to the
  // exclusion of the other. A record that carries none of these is not an
  // advertiser record this parser can attribute, and is skipped.
  function extractAdvertiserName(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const attrs = rec.impressionAttributes;
    if (attrs && typeof attrs === 'object') {
      const nested = extractAdvertiserInfo(attrs.advertiserInfo);
      if (nested) return nested;
    }
    const direct = extractAdvertiserInfo(rec.advertiserInfo);
    if (direct) return direct;
    if (typeof rec.advertiserName === 'string' && rec.advertiserName.trim()) return rec.advertiserName.trim();
    return null;
  }

  function extractAdvertiserInfo(info) {
    if (!info || typeof info !== 'object') return null;
    if (typeof info.advertiserName === 'string' && info.advertiserName.trim()) return info.advertiserName.trim();
    if (typeof info.displayName === 'string' && info.displayName.trim()) return info.displayName.trim();
    if (typeof info.screenName === 'string' && info.screenName.trim()) return info.screenName.trim();
    return null;
  }

  // The impressions/engagements arrays sit at
  // ad.adsUserData.adImpressions.impressions (or .adEngagements.engagements)
  // inside EACH element of the file's top-level array — one element per
  // logged batch, not one element per impression. Both are walked here so a
  // multi-batch file is fully counted, not just its first element.
  function collectAdRecords(value, branch) {
    const out = [];
    if (!Array.isArray(value)) return out;
    value.forEach((entry) => {
      const ad = entry && entry.ad;
      const userData = ad && ad.adsUserData;
      const container = userData && userData[branch];
      const list =
        container && Array.isArray(container.impressions)
          ? container.impressions
          : container && Array.isArray(container.engagements)
          ? container.engagements
          : null;
      if (list) list.forEach((rec) => out.push(rec));
    });
    return out;
  }

  // ---------- classification ----------
  //
  // Routes on the wrapper's own captured key name (`tweet`, `like`,
  // `direct_message`, `ad_impressions`, `ad_engagements`, `account`) rather
  // than the file's path — the same "content decides, not location"
  // discipline the file header describes. X has used a couple of
  // underscore/no-underscore variants of these keys across archive versions
  // (e.g. "tweets" vs "tweet"); matched permissively below rather than as
  // one exact string, since getting this wrong means the whole file is
  // silently skipped.
  function classify(key, value, out) {
    let matched = false;
    const k = String(key || '').toLowerCase();

    if (/^tweet/.test(k)) {
      if (!Array.isArray(value)) return false;
      value.forEach((entry) => {
        const t = entry && entry.tweet;
        if (!t || typeof t !== 'object') {
          out.skippedRecords++;
          return;
        }
        out.tweetCount++;
        const s = toSecondsFromDateString(t.created_at);
        if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
      });
      matched = true;
    } else if (/^like/.test(k)) {
      if (!Array.isArray(value)) return false;
      value.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || !entry.like) {
          out.skippedRecords++;
          return;
        }
        out.likeCount++;
        // X's like.js records carry no timestamp — nothing to add to the
        // span here; see the file-header comment.
      });
      matched = true;
    } else if (/^direct[_-]?message/.test(k)) {
      if (!Array.isArray(value)) return false;
      value.forEach((entry) => {
        const convo = entry && entry.dmConversation;
        if (!convo || typeof convo !== 'object') {
          out.skippedRecords++;
          return;
        }
        out.dmConversationCount++;
        const msgs = Array.isArray(convo.messages) ? convo.messages : [];
        // Counts only — messageCreate/welcomeMessageCreate entries are
        // counted by their presence alone; .text, .senderId, .recipientId
        // are never read on any of them.
        out.dmMessageCount += msgs.length;
      });
      matched = true;
    } else if (/^ad[_-]?impression/.test(k)) {
      collectAdRecords(value, 'adImpressions').forEach((rec) => {
        const name = extractAdvertiserName(rec);
        if (name) {
          out.adImpressionCounts[name] = (out.adImpressionCounts[name] || 0) + 1;
        } else {
          out.skippedRecords++;
        }
      });
      matched = true;
    } else if (/^ad[_-]?engagement/.test(k)) {
      collectAdRecords(value, 'adEngagements').forEach((rec) => {
        const name = extractAdvertiserName(rec);
        if (name) {
          out.adEngagementCounts[name] = (out.adEngagementCounts[name] || 0) + 1;
        } else {
          out.skippedRecords++;
        }
      });
      matched = true;
    } else if (/^account$/.test(k)) {
      if (!Array.isArray(value) || !value.length) return false;
      const acct = value[0] && value[0].account;
      if (acct && typeof acct === 'object') {
        out.owner = {
          username: typeof acct.username === 'string' ? acct.username : null,
          accountDisplayName: typeof acct.accountDisplayName === 'string' ? acct.accountDisplayName : null,
        };
        matched = true;
      }
    }

    return matched;
  }

  // ---------- entry points ----------

  function makeOut() {
    return {
      tweetCount: 0,
      likeCount: 0,
      dmConversationCount: 0,
      dmMessageCount: 0,
      adImpressionCounts: {},
      adEngagementCounts: {},
      owner: null,
      timestamps: [],
      filesScanned: 0,
      filesMatched: 0,
      skippedRecords: 0,
    };
  }

  // Same technique as google.js/meta.js: a loop, not
  // Math.min(...arr)/Math.max(...arr), which is bounded by V8's call-stack
  // argument limit and a large tweets.js can clear it.
  function finalize(out) {
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

    // A combined, deduplicated advertiser name list — impressions and
    // engagements pooled — for callers that just want "which advertisers
    // showed up," alongside the per-mechanism counts for callers that want
    // the breakdown. Neither array is invented from the other: a name
    // present only in engagements (an ad interacted with but, in this
    // archive slice, never logged as shown) still appears once here.
    out.advertisers = [...new Set([...Object.keys(out.adImpressionCounts), ...Object.keys(out.adEngagementCounts)])];

    return out;
  }

  // fileEntries: [{name, text}] — already-read strings. Kept separate from
  // ZIP I/O so this function is pure and trivial to unit test, same as
  // google.js's/meta.js's parseFromEntries().
  function parseFromEntries(fileEntries) {
    const out = makeOut();

    fileEntries.forEach((f) => {
      if (!looksRelevantByPath(f.name)) return;
      out.filesScanned++;
      const parsed = parseYtdFile(f.text);
      if (!parsed) return; // not a YTD-wrapped file — never trusted as one
      if (classify(parsed.key, parsed.value, out)) out.filesMatched++;
    });

    return finalize(out);
  }

  // ---------- size caps, checked BEFORE inflation ----------
  //
  // Identical values to google.js's and meta.js's SIZE_CAPS, for the same
  // reasons documented there — kept as a separate constant here so this
  // module stays self-contained and loads in any order. If these three
  // files' caps are ever changed, change all three.
  const SIZE_CAPS = {
    PER_FILE_BYTES: 50 * 1024 * 1024,
    TOTAL_BYTES: 500 * 1024 * 1024,
  };

  function SizeCapError(message) {
    const e = new Error(message);
    e.code = 'SIZE_CAP_EXCEEDED';
    return e;
  }

  function declaredSize(entry) {
    const d = entry && entry._data;
    return d && typeof d.uncompressedSize === 'number' ? d.uncompressedSize : null;
  }

  function sleep0() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // zip: a JSZip instance. opts.onProgress(done, total), opts.yieldEvery —
  // same contract as google.js's parseArchive(). Only the data/*.js path
  // shape is ever enumerated or inflated; every entry is parsed and
  // classified as soon as its text is read, then discarded, never held
  // alongside the running totals in `out`.
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
      const parsed = parseYtdFile(text);
      if (parsed && classify(parsed.key, parsed.value, out)) out.filesMatched++;

      processed++;
      onProgress(processed, relevantNames.length);
      if (processed % yieldEvery === 0) await sleep0();
    }
    const result = finalize(out);
    result.skipped = skipped;
    return result;
  }

  return {
    isXExport,
    looksLikeXArchiveByPath,
    parseArchive,
    parseFromEntries,
    SIZE_CAPS,
    _internal: {
      parseYtdFile,
      toSecondsFromDateString,
      plausibleSeconds,
      declaredSize,
      looksRelevantByPath,
      extractAdvertiserName,
      YTD_WRAPPER_RE,
    },
  };
});
