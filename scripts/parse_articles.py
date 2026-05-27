#!/usr/bin/env python3
"""
Publisher homepage article link extractor.
Usage:
    python3 scripts/parse_articles.py <homepage_url> <article_url_pattern>

Fetches the homepage with stealth headers, extracts article links whose
URL matches the regex pattern, and outputs a JSON array of
{url, headline} to stdout.

Strategy (tried in order until we have enough articles):
  1. Links found INSIDE heading tags (<h1>–<h4>) that match the pattern.
     This is how most WordPress / news CMSes render article cards.
  2. Headings that appear IMMEDIATELY BEFORE a matching link (within 300 chars).
  3. The anchor text of matching links themselves if it's descriptive enough.
"""

import subprocess
import sys
import json
import re
import html as html_module
import random

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
]

SKIP_HEADLINES = {"read more news", "read more", "more news", "continue reading", ""}


def fetch_page(url: str) -> str:
    ua = random.choice(USER_AGENTS)
    cmd = [
        "curl",
        "--silent",
        "--fail",
        "--location",
        "--max-redirs", "10",
        "--compressed",
        "--max-time", "20",
        "--connect-timeout", "10",
        "-A", ua,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: en-US,en;q=0.9",
        "-H", "Accept-Encoding: gzip, deflate, br",
        "-H", "Cache-Control: no-cache",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: none",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=25)
    if result.returncode != 0:
        raise RuntimeError(f"curl exited {result.returncode}")
    return result.stdout.decode("utf-8", errors="replace")


def clean_text(raw: str) -> str:
    """Strip tags, decode entities, collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html_module.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_href(href: str, base_url: str) -> str:
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return base_url.rstrip("/") + href
    return href


def is_good_headline(text: str) -> bool:
    if len(text) < 12:
        return False
    if text.lower().rstrip("→ ") in SKIP_HEADLINES:
        return False
    return True


def extract_articles(page_html: str, url_pattern: str, base_url: str) -> list[dict]:
    compiled = re.compile(url_pattern, re.IGNORECASE)
    seen_urls: set[str] = set()
    articles: list[dict] = []

    def add(href: str, headline: str) -> bool:
        clean_url = href.split("?")[0].split("#")[0]
        if clean_url in seen_urls:
            return False
        if not compiled.search(href):
            return False
        if not is_good_headline(headline):
            return False
        if len(headline) > 300:
            headline = headline[:297] + "..."
        seen_urls.add(clean_url)
        articles.append({"url": href, "headline": headline})
        return True

    # ── Strategy 1: links INSIDE heading tags ──────────────────────────────────
    # Pattern: <h2 ...> ... <a href="URL"> ... headline text ... </a> ... </h2>
    for h_match in re.finditer(
        r"<h[1-4]\b[^>]*>(.*?)</h[1-4]>",
        page_html,
        re.DOTALL | re.IGNORECASE,
    ):
        heading_html = h_match.group(1)
        a_match = re.search(
            r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
            heading_html,
            re.DOTALL | re.IGNORECASE,
        )
        if not a_match:
            continue
        href = normalize_href(a_match.group(1).strip(), base_url)
        headline = clean_text(a_match.group(2)) or clean_text(heading_html)
        add(href, headline)

    # ── Strategy 2: heading immediately before a matching link (within 400 chars) ─
    # Catches layouts where <h3> and <a href> are siblings, not nested.
    for a_match in re.finditer(
        r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>',
        page_html,
        re.IGNORECASE,
    ):
        href = normalize_href(a_match.group(1).strip(), base_url)
        if not compiled.search(href):
            continue
        clean_url = href.split("?")[0].split("#")[0]
        if clean_url in seen_urls:
            continue

        start = a_match.start()
        context = page_html[max(0, start - 400): start]

        # Find the LAST heading in the context window
        best_heading = ""
        for h_m in re.finditer(
            r"<h[1-4]\b[^>]*>(.*?)</h[1-4]>",
            context,
            re.DOTALL | re.IGNORECASE,
        ):
            candidate = clean_text(h_m.group(1))
            if is_good_headline(candidate):
                best_heading = candidate

        if best_heading:
            add(href, best_heading)

    # ── Strategy 3: anchor text of the link itself ─────────────────────────────
    # Last resort — only if we haven't gotten enough yet.
    if len(articles) < 5:
        for a_match in re.finditer(
            r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
            page_html,
            re.DOTALL | re.IGNORECASE,
        ):
            href = normalize_href(a_match.group(1).strip(), base_url)
            headline = clean_text(a_match.group(2))
            add(href, headline)

    return articles


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: parse_articles.py <url> <url_pattern>"}), file=sys.stderr)
        sys.exit(1)

    page_url = sys.argv[1]
    url_pattern = sys.argv[2]

    base_m = re.match(r"(https?://[^/]+)", page_url)
    base_url = base_m.group(1) if base_m else ""

    try:
        page_html = fetch_page(page_url)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    result = extract_articles(page_html, url_pattern, base_url)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
