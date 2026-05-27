#!/usr/bin/env python3
"""
curl-based web scraper.
Usage:
    python3 scripts/scraper.py <url>

Outputs the fetched HTML to stdout. Exits with code 1 on failure.
"""

import subprocess
import sys
import random
import json

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]


def scrape(url: str) -> str:
    ua = random.choice(USER_AGENTS)
    is_firefox = "Firefox" in ua

    accept = (
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        if is_firefox
        else "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
    )

    cmd = [
        "curl",
        "--silent",
        "--max-redirs", "0",        # do NOT follow any redirects
        "--compressed",             # accept gzip/br
        "--max-time", "20",
        "--connect-timeout", "10",
        "--write-out", "\nHTTP_STATUS:%{http_code}\nFINAL_URL:%{url_effective}",
        "-A", ua,
        "-H", f"Accept: {accept}",
        "-H", "Accept-Language: en-US,en;q=0.9",
        "-H", "Accept-Encoding: gzip, deflate, br",
        "-H", "Cache-Control: no-cache",
        "-H", "Pragma: no-cache",
        "-H", "Upgrade-Insecure-Requests: 1",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: none",
        "-H", "Sec-Fetch-User: ?1",
        url,
    ]

    result = subprocess.run(cmd, capture_output=True, timeout=25)

    raw = result.stdout.decode("utf-8", errors="replace")

    # Extract the appended status/url lines from the body
    http_status = None
    final_url = None
    body_lines = []
    for line in raw.splitlines():
        if line.startswith("HTTP_STATUS:"):
            http_status = line.split(":", 1)[1].strip()
        elif line.startswith("FINAL_URL:"):
            final_url = line.split(":", 1)[1].strip()
        else:
            body_lines.append(line)
    html = "\n".join(body_lines)

    print(f"[scraper] status={http_status} url={final_url} body_len={len(html)}", file=sys.stderr)
    if html:
        snippet = html[:300].replace("\n", " ")
        print(f"[scraper] html_preview: {snippet}", file=sys.stderr)

    # curl exits non-zero (code 47) when redirect is refused — that's expected for 3xx responses
    if result.returncode not in (0, 47):
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"curl exited {result.returncode}: {stderr}")

    if len(html) < 200:
        raise RuntimeError(f"Response too short ({len(html)} bytes) — likely a challenge/block page")

    return html


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: scraper.py <url>"}), file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        html = scrape(url)
        sys.stdout.buffer.write(html.encode("utf-8", errors="replace"))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
