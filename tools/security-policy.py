"""Refresh or check the static pages' CSP hashes after rebuilding any page."""
import argparse
import base64
import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
POLICY_META = re.compile(r'<meta http-equiv="Content-Security-Policy"[^>]*>\r?\n?')
REFERRER_META = re.compile(r'<meta name="referrer"[^>]*>\r?\n?')

def secured(html):
    html = POLICY_META.sub('', REFERRER_META.sub('', html))
    hashes = []
    for attrs, script in re.findall(r'<script\b([^>]*)>(.*?)</script\s*>', html, re.S | re.I):
        if re.search(r'\bsrc\s*=', attrs, re.I):
            continue
        # HTML parsing normalizes line endings before CSP hashing.
        script = script.replace('\r\n', '\n').replace('\r', '\n')
        digest = base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode('ascii')
        hashes.append("'sha256-" + digest + "'")
    scripts = ' '.join(dict.fromkeys(hashes))
    policy = (
        "default-src 'none'; "
        f"script-src {scripts} https://static.cloudflareinsights.com/beacon.min.js; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
        "connect-src https://wtu-call.wetheusers.workers.dev https://cloudflareinsights.com; "
        "manifest-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'"
    )
    newline = '\r\n' if '\r\n' in html else '\n'
    tags = (f'<meta http-equiv="Content-Security-Policy" content="{policy}">{newline}'
            f'<meta name="referrer" content="no-referrer">{newline}')
    result, count = re.subn(r'(<meta charset="utf-8">)(?:\r?\n)?', lambda m: m[1] + newline + tags, html, count=1)
    if count != 1:
        raise ValueError('Expected an early UTF-8 charset meta tag')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    stale = []
    for page in sorted(ROOT.rglob('*.html')):
        if any(part.startswith('.') or part == 'node_modules' for part in page.relative_to(ROOT).parts):
            continue
        with page.open(encoding='utf-8', newline='') as f:
            html = f.read()
        updated = secured(html)
        if html != updated:
            if args.write:
                with page.open('w', encoding='utf-8', newline='') as f:
                    f.write(updated)
            else:
                stale.append(str(page.relative_to(ROOT)))
    if stale:
        raise SystemExit('Stale CSP: ' + ', '.join(stale) + '. Run python tools/security-policy.py --write')
    print('Static page security policies are current.')
