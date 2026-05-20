import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";
import { db, articlesTable } from "@workspace/db";
import { lt, and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../../../cached_articles");

// ── Sources ──────────────────────────────────────────────────────────────────
// Each source has a primary RSS feed (always reliable) and an optional
// homepage URL for full-article scraping. If the HTML fetch fails or is
// blocked we silently fall back to the RSS entry alone.
// Google News RSS search feeds are always publicly accessible (200, valid XML).
// We use site: queries so every result links back to the real publication.
// The second URL is a backup in case Google throttles or changes the format.
const SOURCES = [
  {
    publisher: "SF Chronicle",
    rssUrl:
      "https://news.google.com/rss/search?q=site:sfchronicle.com&hl=en-US&gl=US&ceid=US:en",
    rssUrlFallback:
      "https://news.google.com/rss/search?q=san+francisco+chronicle&hl=en-US&gl=US&ceid=US:en",
  },
  {
    publisher: "The Press Democrat",
    rssUrl:
      "https://news.google.com/rss/search?q=site:pressdemocrat.com&hl=en-US&gl=US&ceid=US:en",
    rssUrlFallback:
      "https://news.google.com/rss/search?q=press+democrat+santa+rosa&hl=en-US&gl=US&ceid=US:en",
  },
];

// ── Stealth headers ───────────────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function stealthHeaders(url: string): Record<string, string> {
  const ua = randomUA();
  const isFirefox = ua.includes("Firefox");
  return {
    "User-Agent": ua,
    Accept: isFirefox
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": isFirefox
      ? ""
      : '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": ua.includes("Windows") ? '"Windows"' : '"macOS"',
    Referer: new URL(url).origin + "/",
  };
}

// Randomized delay: 800ms–3500ms to mimic human pacing
function randomDelay(minMs = 800, maxMs = 3500): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 80) +
    "-" +
    Date.now() +
    ".html"
  );
}

export async function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    await fsPromises.mkdir(CACHE_DIR, { recursive: true });
  }
}

// ── Purge ─────────────────────────────────────────────────────────────────────
export async function purgeOldArticles(): Promise<number> {
  await ensureCacheDir();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const oldArticles = await db
    .select()
    .from(articlesTable)
    .where(
      and(
        lt(articlesTable.fetchedAt, threeDaysAgo),
        eq(articlesTable.isSaved, false),
      ),
    );

  let purgedCount = 0;
  for (const article of oldArticles) {
    if (article.cachePath) {
      try {
        await fsPromises.unlink(article.cachePath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn({ err, path: article.cachePath }, "Failed to delete cache file");
        }
      }
    }
    await db.delete(articlesTable).where(eq(articlesTable.id, article.id));
    purgedCount++;
  }

  if (purgedCount > 0) {
    logger.info({ purgedCount }, "Purged old articles");
  }

  return purgedCount;
}

// ── Fetch one article HTML with stealth headers ───────────────────────────────
async function fetchArticleHtml(
  articleUrl: string,
  headline: string,
): Promise<{ cachePath: string; cacheFilename: string } | null> {
  try {
    const response = await fetch(articleUrl, {
      headers: stealthHeaders(articleUrl),
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    // Treat hard blocks / paywalls as a cache miss — fall back gracefully
    if (!response.ok || response.status === 403 || response.status === 429) {
      logger.warn(
        { url: articleUrl, status: response.status },
        "Article fetch blocked — skipping HTML cache",
      );
      return null;
    }

    const html = await response.text();

    // Heuristic: if response is suspiciously short it's likely a challenge page
    if (html.length < 2000) {
      logger.warn({ url: articleUrl }, "Response too short — possible challenge page, skipping");
      return null;
    }

    const filename = sanitizeFilename(headline);
    const filePath = path.join(CACHE_DIR, filename);
    await fsPromises.writeFile(filePath, html, "utf-8");
    return { cachePath: filePath, cacheFilename: filename };
  } catch (err) {
    logger.warn({ err, url: articleUrl }, "Failed to fetch/cache article HTML — falling back to RSS URL");
    return null;
  }
}

// ── Main fetch orchestrator ───────────────────────────────────────────────────
export async function fetchAndCacheArticles(): Promise<{
  newCount: number;
  purgedCount: number;
}> {
  await ensureCacheDir();
  const purgedCount = await purgeOldArticles();

  const rssParser = new Parser({
    timeout: 15000,
    headers: {
      "User-Agent": randomUA(),
      Accept:
        "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });
  let newCount = 0;

  for (const source of SOURCES) {
    // ── 1. Parse RSS (primary, then fallback URL) ──
    let items: Parser.Item[] = [];
    for (const feedUrl of [source.rssUrl, source.rssUrlFallback]) {
      try {
        const parsed = await rssParser.parseURL(feedUrl);
        items = parsed.items ?? [];
        logger.info({ feedUrl, count: items.length }, "RSS parsed");
        break;
      } catch (err) {
        logger.warn({ err, feedUrl }, "RSS feed parse failed, trying fallback");
      }
    }

    if (items.length === 0) {
      logger.warn({ publisher: source.publisher }, "No items from any RSS URL — skipping source");
      continue;
    }

    // ── 2. Process each article ──
    for (const item of items.slice(0, 20)) {
      const url = item.link ?? item.guid;
      const headline = item.title;
      if (!url || !headline) continue;

      // Deduplicate
      const existing = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.url, url))
        .limit(1);
      if (existing.length > 0) continue;

      // Human-like delay before each fetch
      await randomDelay();

      // Try to cache full HTML; gracefully fall back to null if blocked
      const cached = await fetchArticleHtml(url, headline);

      try {
        await db.insert(articlesTable).values({
          headline,
          publisher: source.publisher,
          url,
          cachePath: cached?.cachePath ?? null,
          cacheFilename: cached?.cacheFilename ?? null,
          isSaved: false,
        });
        newCount++;
      } catch (err) {
        logger.warn({ err, url }, "Failed to insert article (may be duplicate)");
      }
    }
  }

  logger.info({ newCount, purgedCount }, "Fetch complete");
  return { newCount, purgedCount };
}
