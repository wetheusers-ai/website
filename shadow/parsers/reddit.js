/* We the Users — Shadow instrument
 * Reddit data-export parser.
 *
 * Reddit's export is a flat set of named CSV files — no per-product folder
 * tree the way Google's Takeout or Meta's DYI exports have one. Reddit's
 * own "What's in my Reddit data copy?" support page
 * (support.reddithelp.com/hc/en-us/p/what_is_in_my_reddit_data_copy,
 * retrieved 12 September 2026) names exactly 38 files this export can
 * contain, each by its exact CSV filename, with a one-line description of
 * what each holds — REDDIT_CSV_BASENAMES below is that list, verbatim by
 * name. Detection keys off those exact basenames (case-insensitive, any
 * directory depth), never a substring test — see isRedditExport() below
 * for why more than one match, or one sufficiently Reddit-specific match,
 * is required before an archive is trusted as Reddit's.
 *
 * Reddit's own page confirms file NAMES and what each contains; it does
 * not publish column headers. The header names this parser matches against
 * for the seven files it actually reads — posts.csv, comments.csv,
 * post_votes.csv, comment_votes.csv, messages.csv, subscribed_subreddits.csv,
 * saved_posts.csv, saved_comments.csv — are drawn instead from
 * github.com/guilamu/reddit-gdpr-export-viewer's own parsing code
 * (app.js, retrieved 12 September 2026), a third-party tool built against
 * real Reddit exports; they are not a Reddit-published schema, which is why
 * header matching below is tolerant of a header set that is a superset of
 * what is expected, and a file whose header row matches none of the
 * expected columns is skipped rather than guessed at. Likewise the
 * `date` column's format (an ISO-8601-parseable string, per that same
 * source) is read with a tolerant Date.parse(), never assumed to be a
 * Unix timestamp.
 *
 * The archive's own packaging as a single ZIP is also not confirmed by
 * either Reddit-owned page fetched for this file. This project's own
 * published source notes mark the same gap: shadow/data/export-buttons.json's
 * "Reddit" entry, `formats` field, states plainly that ZIP packaging is
 * [UNVERIFIED] against Reddit's own pages. This
 * parser assumes ZIP packaging anyway, because the page this parser will
 * eventually be wired into (see index.html's single `JSZip.loadAsync(file)`
 * call site) only ever hands parsers a zip. If Reddit ships these CSVs
 * unzipped, a human re-zips them (or a future task teaches the page to
 * accept a bare CSV/folder drop) before this parser sees them; that is a
 * page-level concern, not this file's.
 *
 * Never reads: message body, subject, sender, recipient, or date —
 * messages.csv (chat_history.csv is not opened by this parser at all) is
 * read for a count only (see classify() below); a message's date is never
 * pooled into the timestamp span posts and comments produce, on purpose,
 * so that a private message years outside your real posting history can
 * never be the thing that sets "The span"'s number. post/comment title,
 * body, and url are never read either, even though Reddit's own page
 * describes those as things a person posted publicly, not private
 * content, because this parser does not need them for what it reports
 * (counts, the subreddit set, and the timestamp span) and the project's
 * standing rule is not to collect what it does not need.
 *
 * Works two ways:
 *   - In the browser, loaded via <script>, it sets window.RedditParser.
 *   - In Node (the test harness), it exports the same object via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RedditParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- export detection: Reddit's own named file list ----------
  //
  // The full 38-name set from Reddit's own "What's in my Reddit data copy?"
  // page, retrieved 12 September 2026 (see file header). Kept complete —
  // not trimmed to the seven this parser reads — so an export carrying only
  // files this parser does not open (e.g. a birthdate.csv-and-friends.csv-
  // only request) is still recognized as a Reddit export, the same
  // "recognizing vs. reading are different jobs" distinction google.js
  // documents for Takeout's product folders.
  const REDDIT_CSV_BASENAMES = new Set([
    'checkfile.csv', 'user_preferences.csv', 'sensitive_ads_preferences.csv', 'account_gender.csv',
    'twitter.csv', 'subscriptions.csv', 'subscribed_subreddits.csv', 'stripe.csv', 'statistics.csv',
    'scheduled_posts.csv', 'saved_posts.csv', 'saved_comments.csv', 'purchases.csv', 'posts.csv',
    'post_votes.csv', 'post_headers.csv', 'poll_votes.csv', 'persona.csv', 'payouts.csv',
    'multireddits.csv', 'moderated_subreddits.csv', 'messages.csv', 'message_headers.csv',
    'linked_phone_number.csv', 'linked_identities.csv', 'ip_logs.csv', 'hidden_posts.csv',
    'gold_received.csv', 'gilded_content.csv', 'friends.csv', 'drafts.csv', 'comments.csv',
    'comment_votes.csv', 'comment_headers.csv', 'chat_history.csv', 'approved_submitter_subreddits.csv',
    'announcements.csv', 'birthdate.csv',
  ]);

  // A handful of these names are Reddit-specific enough on their own
  // (nothing else calls a file "subscribed_subreddits.csv") that a single
  // match is trusted; the rest (posts.csv, comments.csv, messages.csv...)
  // are generic enough that this parser requires at least two matches from
  // the full set before trusting the file list is Reddit's export, the
  // same multi-signal discipline google.js/meta.js apply to their own
  // detectors.
  const REDDIT_SPECIFIC_BASENAMES = new Set([
    'subscribed_subreddits.csv', 'post_votes.csv', 'comment_votes.csv', 'moderated_subreddits.csv',
    'gilded_content.csv', 'linked_identities.csv', 'multireddits.csv', 'approved_submitter_subreddits.csv',
    'saved_posts.csv', 'saved_comments.csv',
  ]);

  function basename(name) {
    const i = name.lastIndexOf('/');
    return (i === -1 ? name : name.slice(i + 1)).toLowerCase();
  }

  // Cheap pre-check over a file-name list, used by the page to decide
  // whether to route an archive through this parser at all. Matched by
  // exact basename equality, at any directory depth — never a substring
  // test — so an unrelated "my_comments.csv.bak" or a Google Takeout
  // "Saved/comments.csv" cannot match on partial text alone.
  function isRedditExport(names) {
    const matched = new Set();
    for (const n of names) {
      const b = basename(n);
      if (REDDIT_CSV_BASENAMES.has(b)) matched.add(b);
    }
    if (matched.size === 0) return false;
    for (const b of matched) {
      if (REDDIT_SPECIFIC_BASENAMES.has(b)) return true;
    }
    return matched.size >= 2;
  }

  // ---------- the files this parser actually reads ----------

  const READ_BASENAMES = new Set([
    'posts.csv', 'comments.csv', 'post_votes.csv', 'comment_votes.csv',
    'messages.csv', 'subscribed_subreddits.csv', 'saved_posts.csv', 'saved_comments.csv',
  ]);

  function looksRelevantByPath(name) {
    return READ_BASENAMES.has(basename(name));
  }

  // ---------- a small, loop-based CSV parser ----------
  //
  // Hand-rolled rather than split('\n')/split(',') (a naive split breaks on
  // any quoted field containing a comma or an embedded newline — a real
  // Reddit posts.csv/comments.csv body can contain both) and never
  // implemented with a single big regex over the whole file, which is the
  // shape that tends to blow the stack or run catastrophically slow on a
  // large, adversarial input. A straightforward character-by-character
  // state machine, one loop, respecting RFC 4180 quoting (a doubled `""`
  // inside a quoted field is a literal quote).
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\r') {
        // ignore — paired \n (if any) ends the row below
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    // Trailing field/row — a file that does not end in a newline still has
    // its last row read, not silently dropped.
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // Maps a header row to the column indices this parser cares about, for
  // one CSV file. Only the columns present are returned — a file whose
  // header does not include a wanted column simply yields no index for it,
  // handled per-caller (see classify() below), never thrown on.
  function headerIndex(headerRow, wantedCols) {
    const idx = {};
    const lower = headerRow.map((h) => String(h).trim().toLowerCase());
    wantedCols.forEach((col) => {
      const i = lower.indexOf(col);
      if (i !== -1) idx[col] = i;
    });
    return idx;
  }

  function toSecondsFromDateString(v) {
    if (typeof v !== 'string' || !v.trim()) return null;
    const ms = Date.parse(v.trim());
    if (isNaN(ms)) return null;
    return Math.floor(ms / 1000);
  }

  function plausibleSeconds(s) {
    return s > 946684800 && s < 4102444800; // year 2000 .. year 2100
  }

  // ---------- classification ----------
  //
  // name: the file's basename (already matched by looksRelevantByPath).
  // text: the file's full text. out: the running totals object.
  // Returns true if this file's shape was recognized (a header row present,
  // however few of its rows were well-formed) — a completely empty file
  // (no header at all) is not counted as matched.
  function classify(name, text, out) {
    const rows = parseCSV(text);
    if (!rows.length) return false;
    const header = rows[0];
    const dataRows = rows.slice(1);

    if (name === 'posts.csv' || name === 'comments.csv') {
      const idx = headerIndex(header, ['date', 'subreddit']);
      if (idx.date === undefined && idx.subreddit === undefined) return false;
      dataRows.forEach((r) => {
        if (!r.length || (r.length === 1 && r[0] === '')) return; // blank trailing row
        if (name === 'posts.csv') out.postCount++;
        else out.commentCount++;
        if (idx.subreddit !== undefined) {
          const sub = (r[idx.subreddit] || '').trim();
          if (sub) out.subreddits.add(sub);
        }
        if (idx.date !== undefined) {
          const s = toSecondsFromDateString(r[idx.date]);
          if (s != null && plausibleSeconds(s)) out.timestamps.push(s);
          else if (r[idx.date] !== undefined) out.skippedRecords++;
        }
      });
      return true;
    }

    if (name === 'post_votes.csv' || name === 'comment_votes.csv') {
      const idx = headerIndex(header, ['direction']);
      if (idx.direction === undefined) return false;
      const bucket = name === 'post_votes.csv' ? out.postVotes : out.commentVotes;
      dataRows.forEach((r) => {
        if (!r.length || (r.length === 1 && r[0] === '')) return;
        const d = (r[idx.direction] || '').trim().toLowerCase();
        if (d === 'up') bucket.up++;
        else if (d === 'down') bucket.down++;
        else {
          out.skippedRecords++;
          return;
        }
        bucket.total++;
      });
      return true;
    }

    if (name === 'messages.csv') {
      dataRows.forEach((r) => {
        if (!r.length || (r.length === 1 && r[0] === '')) return;
        out.messageCount++;
        // Counts only — from/to/subject/body are never read, on any row,
        // even though the header index for them is knowable; see the file
        // header. A message's date is not read into `out.timestamps`
        // either, on purpose: that array is what "The span" in
        // reddit.findings.js is built from, and a private message —
        // plausibly years older or newer than anything ever posted or
        // commented — must never be the thing that sets a headline
        // claiming to be about posts and comments. Without this
        // exclusion, one message years outside a real posting history
        // would silently set the entire displayed span.
      });
      return true;
    }

    if (name === 'subscribed_subreddits.csv') {
      const idx = headerIndex(header, ['subreddit']);
      if (idx.subreddit === undefined) return false;
      dataRows.forEach((r) => {
        if (!r.length || (r.length === 1 && r[0] === '')) return;
        const sub = (r[idx.subreddit] || '').trim();
        if (sub) out.subreddits.add(sub);
        else out.skippedRecords++;
      });
      return true;
    }

    if (name === 'saved_posts.csv' || name === 'saved_comments.csv') {
      dataRows.forEach((r) => {
        if (!r.length || (r.length === 1 && r[0] === '')) return;
        if (name === 'saved_posts.csv') out.savedPostCount++;
        else out.savedCommentCount++;
      });
      return true;
    }

    return false;
  }

  // ---------- entry points ----------

  function makeOut() {
    return {
      postCount: 0,
      commentCount: 0,
      subreddits: new Set(),
      timestamps: [],
      postVotes: { up: 0, down: 0, total: 0 },
      commentVotes: { up: 0, down: 0, total: 0 },
      messageCount: 0,
      savedPostCount: 0,
      savedCommentCount: 0,
      filesScanned: 0,
      filesMatched: 0,
      skippedRecords: 0,
    };
  }

  // Same technique as google.js/meta.js/x.js: a loop, not
  // Math.min(...arr)/Math.max(...arr).
  function finalize(out) {
    out.subreddits = [...out.subreddits];

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
  // ZIP I/O so this function is pure and trivial to unit test.
  function parseFromEntries(fileEntries) {
    const out = makeOut();

    fileEntries.forEach((f) => {
      if (!looksRelevantByPath(f.name)) return;
      out.filesScanned++;
      if (classify(basename(f.name), f.text, out)) out.filesMatched++;
    });

    return finalize(out);
  }

  // ---------- size caps, checked BEFORE inflation ----------
  //
  // Identical values to google.js's/meta.js's/x.js's SIZE_CAPS, for the
  // same reasons documented there. A Reddit export's largest files in
  // practice are posts.csv/comments.csv/ip_logs.csv for a very long-lived,
  // very active account — well under this per-file cap on any real export,
  // per the same reasoning as the other three parsers' equivalent comment.
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
  // same contract as the other three parsers' parseArchive(). Only the
  // eight basenames this parser reads are ever enumerated or inflated; the
  // other thirty Reddit-named CSVs (ip_logs.csv, birthdate.csv, and the
  // rest) are recognized for isRedditExport() but never opened here.
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
      if (classify(basename(name), text, out)) out.filesMatched++;

      processed++;
      onProgress(processed, relevantNames.length);
      if (processed % yieldEvery === 0) await sleep0();
    }
    const result = finalize(out);
    result.skipped = skipped;
    return result;
  }

  return {
    isRedditExport,
    parseArchive,
    parseFromEntries,
    SIZE_CAPS,
    _internal: {
      parseCSV,
      toSecondsFromDateString,
      plausibleSeconds,
      declaredSize,
      looksRelevantByPath,
      REDDIT_CSV_BASENAMES,
    },
  };
});
