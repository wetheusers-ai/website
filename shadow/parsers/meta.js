/* We the Users — Shadow instrument
 * Meta (Instagram + Facebook) data-export parser.
 *
 * Meta has changed the paths inside these exports at least three times.
 * Detection here is by SHAPE — the structure of the parsed JSON — not by
 * file path. Path hints below are a fast route only: files that match get
 * looked at first, but every .json file in the archive is opened and
 * shape-checked, so a renamed path degrades to "slightly slower," not
 * "silently wrong."
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.MetaParser.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.MetaParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- fast route (optimization only, never load-bearing) ----------

  const PATH_HINTS = [
    /advertisers_using_your_activity/i,
    /advertisers_using_your_information/i,
    /custom_audiences/i,
    /ads_information/i,
    /ads_and_topics/i,
    /messages\/inbox\/.*\/message_\d+\.json$/i,
    /posts_\d+\.json$/i,
    /your_topics/i,
    /recommended_topics/i,
  ];

  function looksRelevantByPath(name) {
    return PATH_HINTS.some((re) => re.test(name));
  }

  // The Meta DYI export's own top-level directory names (Instagram-only,
  // Facebook-only, and the combined Accounts Center layout all draw from
  // this set). Checked against the FIRST path segment only, by exact
  // string equality — never a substring test — so a file that merely
  // mentions "facebook" or "instagram" somewhere in its name (e.g. a
  // Google Takeout "Saved/facebook links.csv") cannot match. This is what
  // W-01 got wrong: /facebook/i.test(name) matches that substring anywhere
  // in the path, including inside another platform's export tree.
  const META_TOP_LEVEL_DIRS = new Set([
    'your_instagram_activity',
    'your_facebook_activity',
    'ads_information',
    'personal_information',
    'logged_information',
    'security_and_login_information',
    'preferences',
    'connections',
    'apps_and_websites_off_of_meta_technologies',
    'apps_and_websites_off_of_facebook',
    'about_you',
  ]);

  function topLevelDir(name) {
    const i = name.indexOf('/');
    return i === -1 ? name : name.slice(0, i);
  }

  // Cheap pre-check over a file-name list, used by the page to decide
  // whether to route a zip through this parser at all. Not used for anything
  // that gets counted — parseArchive() below re-verifies everything by shape.
  // Two independent signals, both structural (never a bare substring match
  // on a platform name): the specific file-shape hints above, or an exact
  // match on one of the export's own known top-level directory names.
  function isMetaExport(names) {
    if (names.some((n) => looksRelevantByPath(n))) return true;
    for (const n of names) {
      if (META_TOP_LEVEL_DIRS.has(topLevelDir(n))) return true;
    }
    return false;
  }

  // ---------- helpers ----------

  function toSeconds(v) {
    const n = Number(v);
    if (!isFinite(n)) return null;
    // Meta mixes seconds (creation_timestamp, ads/topics) and milliseconds
    // (timestamp_ms in messages). Anything this large can only be ms.
    if (n > 1e12) return Math.floor(n / 1000);
    return Math.floor(n);
  }

  function plausibleSeconds(s) {
    return s > 946684800 && s < 4102444800; // year 2000 .. year 2100
  }

  // ---------- shape detectors ----------

  function isAdvertiserEntry(e, wrapperKeyHint) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
    if (typeof e.advertiser_name === 'string' && e.advertiser_name.trim()) return true;
    // Some historical formats used a bare "name" field. Only accept that as
    // an advertiser if the wrapper key itself says so — otherwise this is
    // indistinguishable from a dozen other "list of named things" shapes
    // Meta exports (topics, interests, business names, etc).
    if (
      typeof e.name === 'string' &&
      e.name.trim() &&
      /advertiser|custom_audience/i.test(wrapperKeyHint || '')
    ) {
      return true;
    }
    return false;
  }

  // Find the first array — at the root, or one level under any key — whose
  // items are all advertiser-shaped. Handles every wrapper key Meta has
  // shipped (ig_custom_audiences_all_types, custom_audiences_all_types,
  // advertisers_using_your_activity_or_information, and whatever comes next)
  // because it never looks at the wrapper key's name, only its contents.
  function findAdvertiserArray(j) {
    if (Array.isArray(j)) {
      return j.length && j.every((e) => isAdvertiserEntry(e, '')) ? j : null;
    }
    if (j && typeof j === 'object') {
      for (const k of Object.keys(j)) {
        const v = j[k];
        if (Array.isArray(v) && v.length && v.every((e) => isAdvertiserEntry(e, k))) return v;
      }
    }
    return null;
  }

  function isThreadShape(j) {
    return (
      j &&
      typeof j === 'object' &&
      Array.isArray(j.participants) &&
      Array.isArray(j.messages) &&
      j.messages.length > 0 &&
      j.messages.every(
        (m) =>
          m &&
          typeof m === 'object' &&
          typeof m.sender_name === 'string' &&
          (m.timestamp_ms != null || m.timestamp != null)
      )
    );
  }

  function isPostArray(j) {
    if (!Array.isArray(j) || !j.length) return false;
    return j.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        (p.creation_timestamp != null ||
          (Array.isArray(p.media) && p.media.some((m) => m && m.creation_timestamp != null)))
    );
  }

  // ads_and_topics files (ads viewed, posts viewed, videos watched, search
  // history, and whatever Meta calls the next one) share one shape: an
  // object with a single array-valued key whose items carry a timestamp.
  function findImpressionsArray(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (
        Array.isArray(v) &&
        v.length &&
        v.every(
          (it) =>
            it &&
            typeof it === 'object' &&
            (it.timestamp != null || it.time != null || it.creation_timestamp != null)
        )
      ) {
        return { key: k, items: v };
      }
    }
    return null;
  }

  function findTopicsArray(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    for (const k of Object.keys(j)) {
      if (!/topic/i.test(k)) continue;
      const v = j[k];
      if (
        Array.isArray(v) &&
        v.length &&
        v.every((it) => typeof it === 'string' || (it && typeof it === 'object' && typeof it.name === 'string'))
      ) {
        return v.map((it) => (typeof it === 'string' ? it : it.name));
      }
    }
    return null;
  }

  // ---------- classification ----------

  function classify(name, j, out) {
    let matched = false;

    const advArr = findAdvertiserArray(j);
    if (advArr) {
      advArr.forEach((a) => {
        const n = (a.advertiser_name || a.name || '').trim();
        if (n) out.advertisers.push(n);
      });
      matched = true;
    }

    if (isThreadShape(j)) {
      const participants = j.participants.map((p) => p && p.name).filter(Boolean);
      const timestamps = j.messages
        .map((m) => toSeconds(m.timestamp_ms != null ? m.timestamp_ms : m.timestamp))
        .filter((s) => s != null && plausibleSeconds(s));
      out.threadFiles.push({ file: name, participants, messageCount: j.messages.length });
      timestamps.forEach((s) => out.timestamps.push(s));
      matched = true;
    }

    if (isPostArray(j)) {
      j.forEach((p) => {
        if (p.creation_timestamp != null) {
          const s = toSeconds(p.creation_timestamp);
          if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
        }
        if (Array.isArray(p.media)) {
          p.media.forEach((m) => {
            if (m && m.creation_timestamp != null) {
              const s = toSeconds(m.creation_timestamp);
              if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
            }
          });
        }
      });
      out.posts += j.length;
      matched = true;
    }

    const impressions = findImpressionsArray(j);
    if (impressions) {
      impressions.items.forEach((it) => {
        const raw = it.timestamp != null ? it.timestamp : it.time != null ? it.time : it.creation_timestamp;
        const s = toSeconds(raw);
        if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
      });
      out.adsAndTopicsEvents += impressions.items.length;
      matched = true;
    }

    const topics = findTopicsArray(j);
    if (topics) {
      topics.forEach((t) => out.topics.push(t));
      matched = true;
    }

    return matched;
  }

  // ---------- entry points ----------

  // fileEntries: [{name, text}] — already-read strings. Kept separate from
  // ZIP I/O so this function is pure and trivial to unit test.
  function parseFromEntries(fileEntries) {
    const out = {
      advertisers: [],
      threadFiles: [],
      posts: 0,
      adsAndTopicsEvents: 0,
      topics: [],
      timestamps: [],
      filesScanned: 0,
      filesMatched: 0,
    };

    const hinted = [];
    const rest = [];
    fileEntries.forEach((f) => (looksRelevantByPath(f.name) ? hinted : rest).push(f));
    const restJson = rest.filter((f) => /\.json$/i.test(f.name));

    [...hinted, ...restJson].forEach((f) => {
      out.filesScanned++;
      let j;
      try {
        j = JSON.parse(f.text);
      } catch (e) {
        return;
      }
      if (classify(f.name, j, out)) out.filesMatched++;
    });

    out.advertisers = [...new Set(out.advertisers)];

    // A single conversation can be split across message_1.json,
    // message_2.json, etc. in the same folder — merge by folder so "thread
    // count" means conversations, not chunks.
    const byFolder = new Map();
    out.threadFiles.forEach((t) => {
      const folder = t.file.includes('/') ? t.file.replace(/\/[^/]+$/, '') : t.file;
      if (!byFolder.has(folder)) {
        byFolder.set(folder, { folder, participants: new Set(), messageCount: 0, files: [] });
      }
      const g = byFolder.get(folder);
      t.participants.forEach((p) => g.participants.add(p));
      g.messageCount += t.messageCount;
      g.files.push(t.file);
    });
    out.threads = [...byFolder.values()].map((g) => ({
      folder: g.folder,
      participants: [...g.participants],
      messageCount: g.messageCount,
      files: g.files,
    }));
    delete out.threadFiles;

    // A loop, not Math.min(...arr)/Math.max(...arr) — spreading an array into
    // a function call is bounded by V8's call-stack argument limit. Measured:
    // fine at 124,000 elements, RangeError at 125,000. A decade of Instagram
    // "posts viewed" impressions alone can clear that on an active account.
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

  // ---------- size caps, checked BEFORE inflation ----------
  //
  // A zip's central directory declares each entry's uncompressed size before
  // any bytes are decompressed. A crafted archive can lie about that number
  // (a "zip bomb"), and even an honest one can simply be bigger than a
  // browser tab should try to hold as parsed JSON. Two limits, both checked
  // against the declared size, never the inflated content:
  //
  //   PER_FILE_BYTES  50 MB  — far larger than any single JSON file a real
  //     Meta export ships (message/post/ads-and-topics chunks are typically
  //     well under 5 MB each; Meta itself splits large threads into numbered
  //     chunks specifically to keep individual files small), but small
  //     enough to refuse a single-entry bomb. A file over this line is
  //     skipped — its declared size alone means it is never inflated — and
  //     the rest of the archive is still read.
  //
  //   TOTAL_BYTES  500 MB  — a generous multiple of what a decade of real
  //     activity produces (the FATAL-2 reproduction — 150,000 timestamped
  //     rows in one file — was a few MB uncompressed), left large enough
  //     that an unusually large but honest export still gets read, while
  //     still well inside what a modern browser tab's heap can hold as
  //     parsed JSON plus the parser's own derived arrays without the tab
  //     itself becoming unresponsive or crashing. Crossing this line stops
  //     the whole read — the file that would cross it is never inflated,
  //     and no file after it is opened either.
  const SIZE_CAPS = {
    PER_FILE_BYTES: 50 * 1024 * 1024,
    TOTAL_BYTES: 500 * 1024 * 1024,
  };

  function SizeCapError(message) {
    const e = new Error(message);
    e.code = 'SIZE_CAP_EXCEEDED';
    return e;
  }

  // JSZip does not publish a documented "uncompressed size" accessor, but it
  // populates `entry._data.uncompressedSize` from the zip's central
  // directory before any inflation happens — reading it here costs nothing
  // and touches no compressed bytes. If a future JSZip version renames or
  // removes this field, this returns null and the caller treats the file as
  // unknown-size (allowed through), matching the parser's pre-cap behavior
  // rather than failing the whole archive on a library change.
  function declaredSize(entry) {
    const d = entry && entry._data;
    return d && typeof d.uncompressedSize === 'number' ? d.uncompressedSize : null;
  }

  function sleep0() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // zip: a JSZip instance — anything exposing `.files` (name -> entry with
  // dir/async, and the size-cap check above) matches the API this page
  // already loads from cdnjs.
  //
  // opts.onProgress(done, total) — called as entries are processed, so the
  // caller can drive a progress bar. opts.yieldEvery (default 25) — after
  // this many entries, the loop awaits a zero-delay timeout so a big archive
  // does not freeze the tab between chunks.
  async function parseArchive(zip, opts) {
    const options = opts || {};
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    const yieldEvery = options.yieldEvery || 25;

    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const jsonNames = names.filter((n) => /\.json$/i.test(n));

    const entries = [];
    let totalDeclared = 0;
    let processed = 0;
    for (const name of jsonNames) {
      const entry = zip.files[name];
      const size = declaredSize(entry);

      if (size != null && size > SIZE_CAPS.PER_FILE_BYTES) {
        // Refused by declared size alone — .async() is never called, so
        // this file is never inflated.
        processed++;
        onProgress(processed, jsonNames.length);
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
        onProgress(processed, jsonNames.length);
        continue;
      }
      entries.push({ name, text });
      processed++;
      onProgress(processed, jsonNames.length);
      if (processed % yieldEvery === 0) await sleep0();
    }
    return parseFromEntries(entries);
  }

  // ---------- friend ranking: owner excluded, groups weighted ----------
  //
  // Meta puts the account owner in every thread's `participants` array —
  // ranking people by raw thread participation therefore always puts the
  // owner on top, and credits every member of a group thread with the
  // group's entire message count. Neither is what "who you talk to" means.
  //
  // detectOwner() identifies the owner as the one participant present in
  // EVERY thread. This needs at least three threads to be trustworthy (two
  // people who happen to share every thread in a small export would
  // otherwise look identical to an owner) — below that, no owner is
  // reported and nothing is excluded. This is the method actually used
  // here; the export's own profile/personal_information file, where
  // present, would be a more direct source and is a natural follow-up, but
  // is not read by this parser today.
  function detectOwner(threads) {
    const list = threads || [];
    if (list.length < 3) return null;
    const counts = {};
    list.forEach((t) => {
      const seen = new Set((t.participants || []).filter(Boolean));
      seen.forEach((p) => {
        counts[p] = (counts[p] || 0) + 1;
      });
    });
    const owner = Object.keys(counts).find((p) => counts[p] === list.length);
    return owner || null;
  }

  // Ranks people by weighted thread participation: the owner (per
  // detectOwner, or opts.owner if the caller already knows it) is excluded,
  // and each thread's message count is divided evenly among its OTHER
  // participants, so a forty-person group thread credits each of the other
  // thirty-nine with a fortieth of the thread, not the whole thing.
  function friendScores(threads, opts) {
    const options = opts || {};
    const list = threads || [];
    const owner = options.owner !== undefined ? options.owner : detectOwner(list);
    const scores = {};
    list.forEach((t) => {
      const others = (t.participants || []).filter((p) => p && p !== owner);
      if (!others.length) return;
      const share = (t.messageCount || 0) / others.length;
      others.forEach((p) => {
        scores[p] = (scores[p] || 0) + share;
      });
    });
    return { owner, scores };
  }

  return {
    isMetaExport,
    parseArchive,
    parseFromEntries,
    SIZE_CAPS,
    detectOwner,
    friendScores,
    _internal: { toSeconds, plausibleSeconds, findAdvertiserArray, isThreadShape, isPostArray, declaredSize },
  };
});
