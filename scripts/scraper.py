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
        "--fail",
        "--location",               # follow redirects
        "--max-redirs", "10",
        "--compressed",             # accept gzip/br
        "--max-time", "20",
        "--connect-timeout", "10",
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

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"curl exited {result.returncode}: {stderr}")

    html = result.stdout.decode("utf-8", errors="replace")

    if len(html) < 500:
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
