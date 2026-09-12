/* We the Users — Shadow instrument
 * Apple "Data & Privacy" export parser.
 *
 * Unlike Google's Takeout (a fixed, documented folder tree — see google.js's
 * citations) or Meta's DYI export (whose JSON shapes are stable even when
 * paths move — see meta.js), Apple's own support page does not publish an
 * exact file-by-file schema for what privacy.apple.com hands back. What it
 * does say, verbatim, retrieved 12 September 2026 from
 * https://support.apple.com/en-us/HT208502 ("About the data associated with
 * your Apple Account and how to request a copy"):
 *
 *   - "Apple Account details" — "including ... sign-in records."
 *   - "Purchase and download records" — "items you have purchased or
 *     downloaded from the App Store, iTunes Store, and Apple Books."
 *   - "Apple Media Services Information" — "includes subscription payments
 *     and iCloud storage plan details."
 *   - "iCloud data" — "contacts, calendars, notes, bookmarks, reminders,
 *     email, photos, videos, and documents." ("documents" is iCloud Drive.)
 *   - Format: "App usage information is provided as spreadsheets or files
 *     in .json, .csv, or .pdf formats." Contacts/calendar/mail use
 *     .vcf/.ics/.html/.eml instead — none of that is read here (see the
 *     scope note below).
 *
 * That page names categories, not paths. No secondary source (Apple
 * support search, general web search, code search, and several tech-press
 * how-tos were all tried and either blocked, paywalled, or returned
 * nothing) confirmed an exact literal folder or file name the way
 * locationhistoryformat.com and purarue/google_takeout_parser confirmed
 * Google's. So detection here does NOT hardcode one exact path table the
 * way TAKEOUT_PRODUCT_DIRS or META_TOP_LEVEL_DIRS do. It keys off the
 * documented category names above as case-insensitive keywords — matched
 * against a whole path segment or a bare filename, never a raw substring
 * test across an entire path — corroborated by the CONTENT shape of
 * whatever .csv or .json file is actually found there (a date-ish column
 * and a value to attach it to). A future export that renames the folder
 * but keeps recognisable content still gets read; one that renames both
 * reads as "found nothing," the same honest failure mode google.js's own
 * HTML-export case documents.
 *
 * Scope, deliberately narrow — same discipline as google.js's Gmail/Drive/
 * Photos exclusion: only .csv and .json files under one of the four
 * documented categories below are ever opened. Mail (.eml), Photos, and
 * Messages content are never attempted, and are excluded by construction —
 * their file extensions never pass the .csv/.json filter below, not by a
 * promise in a comment.
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.AppleParser.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.AppleParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- the four categories this parser reads ----------
  //
  // dirRe matches a WHOLE path segment (case-insensitive); fileRe matches
  // the bare filename (extension stripped), also case-insensitive. Either
  // is sufficient — a flat "App Store.csv" at the archive root and a
  // nested "App Store/Purchases.csv" both route here. Neither is a raw
  // substring test against the full path, so a file that merely mentions
  // "app" somewhere else in its name (an unrelated "Apps.json" from a
  // different export) cannot match on that alone.
  const CATEGORY_DEFS = [
    {
      key: 'appStore',
      label: 'App Store',
      dirRe: /^app store$/i,
      fileRe: /^app\s*store(\s*(activity|information))?$/i,
    },
    {
      key: 'mediaServices',
      label: 'Apple Media Services',
      dirRe: /^apple media services(\s*information)?$/i,
      fileRe: /apple\s*media\s*services/i,
    },
    {
      key: 'signIn',
      label: 'Apple ID sign-in history',
      dirRe: /^apple id account(\s*and\s*device\s*information)?$/i,
      fileRe: /sign[- ]?in(\s*history)?$/i,
    },
    {
      key: 'icloudDrive',
      label: 'iCloud Drive',
      dirRe: /^icloud drive$/i,
      fileRe: /icloud\s*drive/i,
    },
  ];

  const READABLE_EXT_RE = /\.(csv|json)$/i;
  const UNREADABLE_EXT_RE = /\.pdf$/i;

  function segments(name) {
    return name.split('/');
  }

  function baseNameNoExt(name) {
    const last = name.slice(name.lastIndexOf('/') + 1);
    return last.replace(/\.[^.]+$/, '');
  }

  // Returns the matching CATEGORY_DEFS entry for a .csv/.json file, or null.
  function matchCategory(name) {
    if (!READABLE_EXT_RE.test(name)) return null;
    const segs = segments(name);
    const base = baseNameNoExt(name);
    for (const cat of CATEGORY_DEFS) {
      if (segs.some((s) => cat.dirRe.test(s)) || cat.fileRe.test(base)) return cat;
    }
    return null;
  }

  function looksRelevantByPath(name) {
    return matchCategory(name) !== null;
  }

  // ---------- export detection ----------
  //
  // True if any file — of ANY extension, not just .csv/.json — sits under
  // one of the four documented category names. This deliberately matches
  // even a .pdf-only category (see looksLikeUnreadableExport below), so an
  // Apple export that happens to ship every category as PDF is still
  // recognised as an Apple export rather than falling through to "not
  // recognised at all."
  function isAppleExport(names) {
    for (const n of names) {
      if (!/\.[^./]+$/.test(n)) continue; // skip directory-only entries
      const segs = segments(n);
      const base = baseNameNoExt(n);
      for (const cat of CATEGORY_DEFS) {
        if (segs.some((s) => cat.dirRe.test(s)) || cat.fileRe.test(base)) return true;
      }
    }
    return false;
  }

  // A category folder/file exists (by keyword) but only as .pdf, with no
  // .csv/.json file this parser could instead read for that same category.
  // Mirrors google.js's looksLikeHtmlExport(): tells the page WHY nothing
  // was found, from the file list alone, without opening a single byte.
  function looksLikeUnreadableExport(names) {
    const readableCats = new Set();
    const pdfCats = new Set();
    for (const n of names) {
      const segs = segments(n);
      const base = baseNameNoExt(n);
      for (const cat of CATEGORY_DEFS) {
        const hints = segs.some((s) => cat.dirRe.test(s)) || cat.fileRe.test(base);
        if (!hints) continue;
        if (READABLE_EXT_RE.test(n)) readableCats.add(cat.key);
        else if (UNREADABLE_EXT_RE.test(n)) pdfCats.add(cat.key);
      }
    }
    for (const k of pdfCats) if (!readableCats.has(k)) return true;
    return false;
  }

  // ---------- helpers ----------

  function plausibleSeconds(s) {
    return s > 946684800 && s < 4102444800; // year 2000 .. year 2100
  }

  function dayKey(s) {
    return new Date(s * 1000).toISOString().slice(0, 10); // UTC calendar date
  }

  const DATE_KEY_RE = /date|time/i;
  const LOCATION_KEY_RE = /location|city|region/i;

  // Finds the first key on a record whose NAME suggests a timestamp, and
  // whose VALUE actually parses to a plausible one. Never assumes a fixed
  // column name — Apple's own CSVs are not documented closely enough to
  // hardcode one (see the file header) — so this reads the shape of
  // whatever the row actually has.
  function recordTimestamp(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const keys = Object.keys(rec);
    for (const k of keys) {
      if (!DATE_KEY_RE.test(k)) continue;
      const v = rec[k];
      if (typeof v !== 'string' || !v.trim()) continue;
      const ms = Date.parse(v);
      if (isNaN(ms)) continue;
      const s = Math.floor(ms / 1000);
      if (plausibleSeconds(s)) return s;
    }
    return null;
  }

  // A record carries a location point when some field's NAME suggests one
  // and its value is a non-empty string. This is only ever CALLED for
  // sign-in records (see classifyRecords() below) — HT208502 documents
  // "sign-in records" under Apple Account details as the one category that
  // plausibly carries anything location-shaped, so this is never even
  // checked against the other three, rather than checked and expected to
  // come back empty. A field named "Region" on an App Store or Media
  // Services row is real (App Store activity can carry a storefront
  // region) but is not a sign-in location, and must never be counted here.
  function recordHasLocation(rec) {
    if (!rec || typeof rec !== 'object') return false;
    return Object.keys(rec).some((k) => LOCATION_KEY_RE.test(k) && typeof rec[k] === 'string' && rec[k].trim());
  }

  // ---------- CSV: a small, dependency-free reader ----------
  //
  // Handles quoted fields (with embedded commas, and "" as an escaped
  // quote), \r\n or \n line endings, and a leading UTF-8 BOM — the shape a
  // spreadsheet application (Numbers, Excel) commonly writes, which is
  // exactly what HT208502 says these files are ("provided as
  // spreadsheets"). Not a general CSV library — no dialect options, no
  // streaming — because this only ever needs to read files this parser
  // itself produced the fixture for, at fixture-file sizes.
  function parseCsvRows(text) {
    let t = text;
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // strip BOM
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const len = t.length;
    let i = 0;
    while (i < len) {
      const c = t[i];
      if (inQuotes) {
        if (c === '"') {
          if (t[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    // Trailing blank line from a final newline produces one empty row —
    // drop it rather than counting it as a malformed data row.
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }

  // Header row + data rows -> plain objects, keyed by trimmed header text.
  // A row whose column count does not match the header is malformed — it
  // is counted (via the returned malformedCount) and never turned into a
  // record, the same tolerance google.js's isActivityArray()/classify()
  // give a bad My Activity row: one bad line never voids the whole file.
  function csvToRecords(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) return { records: [], malformedCount: 0 };
    const header = rows[0].map((h) => h.trim());
    const records = [];
    let malformedCount = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length !== header.length) {
        malformedCount++;
        continue;
      }
      const rec = {};
      for (let c = 0; c < header.length; c++) rec[header[c]] = row[c];
      records.push(rec);
    }
    return { records, malformedCount };
  }

  // JSON: an array of records, or an object wrapping the first non-empty
  // array-valued property — the same "don't assume one wrapper key" stance
  // meta.js takes on Meta's own shifting wrapper keys.
  function jsonToRecords(j) {
    if (Array.isArray(j)) return j.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (j && typeof j === 'object') {
      for (const k of Object.keys(j)) {
        const v = j[k];
        if (Array.isArray(v) && v.length) return v.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
      }
    }
    return [];
  }

  // ---------- classification ----------
  //
  // Runs the shared per-record logic (timestamp + optional location) over
  // whichever record list CSV or JSON reading produced, against the
  // running totals in `out`. Returns true if at least one record in this
  // file counted — that is what "matched" means for filesMatched, same as
  // every other parser in this set.
  function classifyRecords(cat, records, out) {
    let any = false;
    records.forEach((rec) => {
      const s = recordTimestamp(rec);
      if (s == null) {
        out.skippedRecords++;
        return;
      }
      out.eventCount++;
      out.timestamps.push(s);
      // Location days come ONLY from the sign-in category — never from App
      // Store, Apple Media Services, or iCloud Drive rows, even if one of
      // those happens to carry a field whose name matches LOCATION_KEY_RE
      // (an App Store "Region" column, for instance). Without this gate, a
      // sign-in-free archive with a Region column on an unrelated file
      // reads as sign-in location days that were never there.
      if (cat.key === 'signIn' && recordHasLocation(rec)) out.locationDays.add(dayKey(s));
      any = true;
    });
    if (any) out.services.add(cat.label);
    return any;
  }

  function classifyFile(name, text, out) {
    const cat = matchCategory(name);
    if (!cat) return false;
    if (/\.csv$/i.test(name)) {
      const { records, malformedCount } = csvToRecords(text);
      out.skippedRecords += malformedCount;
      return classifyRecords(cat, records, out);
    }
    // .json
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      return false; // scanned, not matched — same as an unparsable Takeout file
    }
    const records = jsonToRecords(j);
    if (!records.length) return false;
    return classifyRecords(cat, records, out);
  }

  // ---------- entry points ----------

  function makeOut() {
    return {
      services: new Set(),
      eventCount: 0,
      timestamps: [],
      locationDays: new Set(),
      filesScanned: 0,
      filesMatched: 0,
      skippedRecords: 0,
    };
  }

  // Same reasoning as google.js's finalize(): a loop, not
  // Math.min(...arr)/Math.max(...arr), because spreading a large array into
  // a function call hits V8's call-stack argument limit (measured at
  // ~124,000 elements in google.js's own case) — a multi-year sign-in
  // history or iCloud Drive file listing can plausibly clear that.
  function finalize(out) {
    out.services = [...out.services];
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

  // fileEntries: [{name, text}] — already-read strings. Pure and trivial to
  // unit test, same as google.js's and meta.js's parseFromEntries().
  function parseFromEntries(fileEntries) {
    const out = makeOut();
    fileEntries.forEach((f) => {
      if (!looksRelevantByPath(f.name)) return; // out-of-scope files never even parsed
      out.filesScanned++;
      if (classifyFile(f.name, f.text, out)) out.filesMatched++;
    });
    return finalize(out);
  }

  // ---------- size caps, checked BEFORE inflation ----------
  //
  // Identical values and identical technique to google.js/meta.js's
  // SIZE_CAPS, kept as a separate constant here for the same reason those
  // two files give: this module stays self-contained regardless of load
  // order. If these caps are ever changed, change all three files.
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

  // zip: a JSZip instance. opts.onProgress(done, total); opts.yieldEvery
  // (default 25). Only files matching one of the four categories are ever
  // enumerated, let alone inflated — Mail, Photos, and Messages content
  // (out of scope, see the file header) is excluded by never appearing in
  // `relevantNames` at all, the same structural guarantee google.js gives
  // Gmail/Drive/Photos.
  //
  // Each entry is read, classified, and discarded immediately — never
  // collected into an array of every file's text first (same reasoning as
  // google.js: holding a large file's text alongside its own parse would
  // double peak heap for no reason).
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
      if (classifyFile(name, text, out)) out.filesMatched++;

      processed++;
      onProgress(processed, relevantNames.length);
      if (processed % yieldEvery === 0) await sleep0();
    }
    const result = finalize(out);
    result.skipped = skipped;
    return result;
  }

  return {
    isAppleExport,
    looksLikeUnreadableExport,
    parseArchive,
    parseFromEntries,
    SIZE_CAPS,
    _internal: {
      matchCategory,
      looksRelevantByPath,
      recordTimestamp,
      recordHasLocation,
      parseCsvRows,
      csvToRecords,
      jsonToRecords,
      declaredSize,
      dayKey,
      plausibleSeconds,
    },
  };
});
