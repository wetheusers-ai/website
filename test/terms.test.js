/* Falsifiability test for website/terms/index.html: every quote on the page
 * must be a real, verbatim fragment of a primary source — not merely
 * consistent with our own notes about that source.
 *
 * Two tiers, from strongest to weakest evidence:
 *
 *   1. Where this project kept a raw capture of the platform's own page
 *      (in its private working directory — currently X, Amazon, and
 *      Reddit, all captured 14 September 2026 through a real browser after
 *      their sites refused the tool used on the other seven), every quote
 *      the page attributes to that platform is checked directly against
 *      the captured text itself. This is the stronger check: it would
 *      catch a quote whose ellipsis silently drops a sentence that
 *      contradicts what was kept, because the missing sentence simply
 *      isn't in the captured text this test reads.
 *   2. For the other seven platforms — retrieved 10 September, no raw
 *      capture kept — the check falls back to this project's private
 *      working notes (kept outside website/, not part of the published
 *      repo), the same as before. This tier only proves the page agrees
 *      with our notes, not that our notes were right; it is real
 *      evidence, but weaker.
 *
 * A quote containing an ellipsis ("…" or "...") is split into its
 * surrounding fragments first; each fragment must appear, in order, as a
 * literal substring of the reference text. Curly quotes in the reference
 * text are normalized to straight before comparing, and all whitespace is
 * collapsed, so line breaks and typographic choices don't cause a false
 * failure — an actual wording change still will, because every other
 * character must match.
 *
 * A checkout that only took website/ has none of this project's private
 * working directory present — no working notes for tier 2, no raw
 * captures for tier 1 — so this test SKIPS loudly rather than silently
 * passing.
 *
 * Run with:
 *   node website/test/terms.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PRIVATE_ROOT = path.join(ROOT, '..', 'lab');
const DATA_PATH = path.join(PRIVATE_ROOT, 'data', 'terms-read.json');
const RAW_DIR = path.join(PRIVATE_ROOT, 'data', 'terms-raw');
const PAGE_PATH = path.join(ROOT, 'terms', 'index.html');

const SILENT_PLACEHOLDER = '[UNVERIFIED — policy silent]';
const SILENT_STANDIN = '(the policy is silent on this)';

// Platform name (as it appears in the page's own <h2>, and in the private
// working notes' "platform" field) -> the filename prefix, inside this
// project's private raw-capture directory, that captures it. A platform
// absent from this map has no raw capture and falls back to the working
// notes alone.
const RAW_CAPTURE_PREFIX = {
  'X (Twitter)': 'x-',
  Amazon: 'amazon-',
  Reddit: 'reddit-',
};

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// Curly quotes to straight, then every remaining quote character dropped —
// tolerates a page's single/double nested-quote convention, and a raw
// capture's own curly apostrophes, without tolerating a real wording
// change. Whitespace (including line breaks in a raw capture) collapsed
// to single spaces.
function norm(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// An ellipsis, either character, splits a quote into the fragments a
// source-check must confirm independently — the ellipsis itself asserts
// nothing.
function splitOnEllipsis(s) {
  return s
    .split(/…|\.\.\./)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

// Standard quotation practice re-punctuates the boundary of a quoted
// clause — closing it with a period, or a comma where prose continues
// around it — even where the source's own mark there is a semicolon,
// comma, or period, because the sentence continues on to an unrelated
// clause (this exact case — an X Terms of Service quote closed with a
// period where the source has a semicolon — was hand-checked and accepted
// as no alteration of substance). This checks the exact fragment first,
// and only if that fails, retries with one trailing [.,;:] dropped — it
// does not tolerate any other punctuation or wording difference, and
// never touches punctuation in the middle of a fragment.
function foundIn(haystack, needle) {
  if (haystack.includes(needle)) return true;
  if (/[.,;:]$/.test(needle)) return haystack.includes(needle.slice(0, -1));
  return false;
}

// Pull every <span class="q">…</span> out of one platform's slice of the
// rendered page (decoded, so &quot; etc. read as real characters).
function extractQuoteSpans(sectionHtml) {
  const out = [];
  const re = /<span class="q">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(sectionHtml))) out.push(decodeEntities(m[1]));
  return out;
}

// Slice the page into one HTML chunk per <h2>…</h2> platform section.
function splitByPlatform(html) {
  const re = /<h2>([^<]+)<\/h2>/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ name: m[1].trim(), start: m.index, contentStart: re.lastIndex });
  const sections = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : html.length;
    sections[marks[i].name] = html.slice(marks[i].contentStart, end);
  }
  return sections;
}

function main() {
  assert.ok(fs.existsSync(PAGE_PATH), `page missing: ${PAGE_PATH}`);
  const rawHtml = fs.readFileSync(PAGE_PATH, 'utf8');
  const sections = splitByPlatform(rawHtml);

  assert.ok(
    !rawHtml.includes(SILENT_PLACEHOLDER),
    `the raw "${SILENT_PLACEHOLDER}" placeholder must never render on the page — it should ` +
      `become "${SILENT_STANDIN}" instead`
  );
  assert.ok(
    rawHtml.includes(SILENT_STANDIN),
    `expected the muted stand-in "${SILENT_STANDIN}" somewhere on the page (Amazon's "keeps" entry ` +
      `has no retention clause in the source)`
  );

  if (!fs.existsSync(PRIVATE_ROOT)) {
    console.log(
      'SKIP — this project\'s private working directory is not present in this checkout, so there ' +
        'is neither a working-notes file nor a raw-capture directory to check ' +
        'website/terms/index.html against. Not a failure: a checkout that only took website/ cannot ' +
        'carry this check.'
    );
    return;
  }

  // ---- Tier 1: platforms with a raw capture ------------------------------
  let tier1Checked = 0;
  const tier1Platforms = Object.keys(RAW_CAPTURE_PREFIX).filter((p) => sections[p]);

  for (const [platform, prefix] of Object.entries(RAW_CAPTURE_PREFIX)) {
    const section = sections[platform];
    assert.ok(section, `page has no <h2>${platform}</h2> section — expected one`);
    const files = fs.existsSync(RAW_DIR)
      ? fs.readdirSync(RAW_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.txt'))
      : [];
    assert.ok(files.length > 0, `no raw-capture file found for ${platform} (expected a "${prefix}*.txt" in the private raw-capture directory)`);
    const rawText = norm(files.map((f) => fs.readFileSync(path.join(RAW_DIR, f), 'utf8')).join('\n'));

    for (const quote of extractQuoteSpans(section)) {
      for (const fragment of splitOnEllipsis(quote)) {
        const needle = norm(fragment);
        // A fragment that normalizes to nothing (a bare quote mark left
        // after the source's own ellipsis, e.g. TikTok's "...") carries no
        // claim to check — skip it rather than treat it as a failure.
        if (needle.length === 0) continue;
        assert.ok(
          foundIn(rawText, needle),
          `${platform}: quote fragment "${fragment.slice(0, 90)}${fragment.length > 90 ? '…' : ''}" ` +
            `not found verbatim in the raw capture for ${platform}`
        );
        tier1Checked += 1;
      }
    }
  }
  console.log(
    `PASS — ${tier1Checked} quote fragment(s) across ${tier1Platforms.length} platform(s) ` +
      `(${tier1Platforms.join(', ')}) checked verbatim against their raw captures.`
  );

  // ---- Tier 2: the remaining platforms, checked against the working notes
  assert.ok(fs.existsSync(DATA_PATH), `private working directory is present but its terms-read data file is missing`);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  let tier2Checked = 0;
  let silentChecked = 0;
  const tier2Platforms = [];

  for (const platform of data.platforms) {
    if (RAW_CAPTURE_PREFIX[platform.platform]) continue; // already checked, tier 1
    tier2Platforms.push(platform.platform);
    const section = sections[platform.platform];
    assert.ok(section, `page has no <h2>${platform.platform}</h2> section — expected one`);

    // The full set of what the working notes recorded as read for this
    // platform, concatenated with separators that can't form an accidental
    // cross-entry match, is the reference a page quote must be a
    // substring of. `section` and `notes` are included too, not just
    // `quote` — the page occasionally names a section heading in its own
    // right (e.g. Google's "U.S. state law requirements"), and those
    // headings are recorded, verified, in this file's `section`/`notes`
    // fields rather than duplicated into `quote`.
    const referencePieces = [];
    for (const entry of platform.entries) {
      if (entry.quote.includes('UNVERIFIED')) {
        assert.ok(
          section.includes(SILENT_STANDIN),
          `${platform.platform} / ${entry.topic} is marked unverified in the readings but its section ` +
            `of the page has no "${SILENT_STANDIN}" text`
        );
        silentChecked += 1;
        continue;
      }
      referencePieces.push(...entry.quote.split(' / '));
      if (entry.section) referencePieces.push(entry.section);
      if (entry.notes) referencePieces.push(entry.notes);
    }
    const reference = norm(referencePieces.join('  •  '));

    for (const quote of extractQuoteSpans(section)) {
      for (const fragment of splitOnEllipsis(quote)) {
        const needle = norm(fragment);
        if (needle.length === 0) continue;
        assert.ok(
          foundIn(reference, needle),
          `${platform.platform}: quote fragment "${fragment.slice(0, 90)}${fragment.length > 90 ? '…' : ''}" ` +
            `not found in the working notes' recorded readings for this platform`
        );
        tier2Checked += 1;
      }
    }
  }

  assert.ok(tier1Checked + tier2Checked > 0, 'expected at least one quote fragment to check — found none');
  console.log(
    `PASS — ${tier2Checked} quote fragment(s) across ${tier2Platforms.length} platform(s) with no raw ` +
      `capture (${tier2Platforms.join(', ')}) matched the working notes; ${silentChecked} silent-policy ` +
      `entry(ies) render as "${SILENT_STANDIN}" with no bracket.`
  );
  console.log(
    `NOTE — platforms with no raw capture, checked only against our own working notes: ` +
      `${tier2Platforms.join(', ')}.`
  );
}

main();
