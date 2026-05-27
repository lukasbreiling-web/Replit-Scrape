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
// Google News RSS feeds — always publicly accessible, no API key required.
// The "site:" operator ensures results link to the real publication.
// A fallback URL is tried if the primary fails (e.g. Google throttle).
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

// ── Stealth headers for RSS parser ────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
export async function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    await fsPromises.mkdir(CACHE_DIR, { recursive: true });
  }
}

// ── Purge ─────────────────────────────────────────────────────────────────────
export async function purgeOldArticles(): Promise<number> {
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

// Strip HTML tags from RSS description snippets (Google News wraps them in <a> tags)
function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, "").trim();
}

// Extract a clean description from a RSS item, removing author/byline boilerplate
function extractDescription(item: Parser.Item): string | null {
  const raw =
    (item as Record<string, unknown>)["content:encoded"] as string | undefined
    ?? item.contentSnippet
    ?? item.content
    ?? item.summary
    ?? null;

  if (!raw) return null;

  const text = stripHtml(raw).trim();
  if (!text || text.length < 10) return null;

  // Google News descriptions are usually "<headline> - Publisher Name"
  // Strip the trailing " - Publisher" suffix if it looks like that pattern
  const cleaned = text.replace(/\s*[-–]\s*[A-Z][^-–]{3,40}$/, "").trim();
  return cleaned || null;
}

// ── RSS parsing with retry ─────────────────────────────────────────────────────
async function parseRssFeed(
  parser: Parser,
  feedUrl: string,
  retries = 2,
): Promise<Parser.Item[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const parsed = await parser.parseURL(feedUrl);
      const items = parsed.items ?? [];
      logger.info({ feedUrl, count: items.length, attempt }, "RSS parsed");
      return items;
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") || err.message.includes("Too Many Requests"));

      if (isRateLimit) {
        logger.warn({ feedUrl, attempt }, "RSS rate-limited (429) — waiting before retry");
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      } else if (attempt < retries) {
        logger.warn({ err, feedUrl, attempt }, "RSS parse failed — retrying");
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        logger.warn({ err, feedUrl }, "RSS parse failed after all retries");
      }
    }
  }
  return [];
}

// ── Main fetch orchestrator ───────────────────────────────────────────────────
export async function fetchAndCacheArticles(): Promise<{
  newCount: number;
  purgedCount: number;
  errors: string[];
}> {
  const purgedCount = await purgeOldArticles();

  const rssParser = new Parser({
    timeout: 18000,
    headers: {
      "User-Agent": randomUA(),
      Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    customFields: {
      item: [["content:encoded", "content:encoded"]],
    },
  });

  let newCount = 0;
  const errors: string[] = [];

  for (const source of SOURCES) {
    logger.info({ publisher: source.publisher }, "Processing source");

    // ── 1. Parse RSS — try primary URL then fallback ──
    let items: Parser.Item[] = [];

    for (const feedUrl of [source.rssUrl, source.rssUrlFallback]) {
      items = await parseRssFeed(rssParser, feedUrl);
      if (items.length > 0) break;
      logger.warn(
        { publisher: source.publisher, feedUrl },
        "No items from feed — trying fallback",
      );
    }

    if (items.length === 0) {
      const msg = `No items from any RSS URL for ${source.publisher}`;
      logger.warn({ publisher: source.publisher }, msg);
      errors.push(msg);
      continue;
    }

    // ── 2. Process each item ──
    for (const item of items.slice(0, 20)) {
      // Robust field extraction with fallbacks
      const url = (item.link ?? item.guid ?? "").trim();
      const rawHeadline = (item.title ?? item.contentSnippet ?? "Untitled").trim();
      // Google News appends " - Publisher Name" to every title — strip it
      const headline = rawHeadline
        .replace(/\s*[-–]\s*(SF Chronicle|San Francisco Chronicle|The Press Democrat|Press Democrat)\s*$/i, "")
        .trim() || rawHeadline;

      if (!url) {
        logger.warn({ item }, "RSS item missing URL — skipping");
        continue;
      }
      if (!headline) {
        logger.warn({ url }, "RSS item missing headline — skipping");
        continue;
      }

      // Validate URL shape
      try {
        new URL(url);
      } catch {
        logger.warn({ url }, "RSS item has malformed URL — skipping");
        continue;
      }

      // Deduplicate by URL
      try {
        const existing = await db
          .select({ id: articlesTable.id })
          .from(articlesTable)
          .where(eq(articlesTable.url, url))
          .limit(1);
        if (existing.length > 0) continue;
      } catch (err) {
        logger.error({ err, url }, "DB dedup check failed — skipping article");
        errors.push(`DB error for ${url}`);
        continue;
      }

      // Extract description and publication date from the RSS item itself
      const description = extractDescription(item);
      const publishedAt = item.pubDate ? new Date(item.pubDate) : null;

      try {
        await db.insert(articlesTable).values({
          headline,
          publisher: source.publisher,
          url,
          description: description ?? null,
          publishedAt: publishedAt ?? null,
          cachePath: null,
          cacheFilename: null,
          isSaved: false,
        });
        newCount++;
        logger.info(
          { headline: headline.slice(0, 60), publisher: source.publisher },
          "Article stored",
        );
      } catch (err: unknown) {
        const isDuplicate =
          err instanceof Error &&
          (err.message.includes("unique") || err.message.includes("duplicate"));
        if (!isDuplicate) {
          logger.warn({ err, url }, "Failed to insert article");
          errors.push(`Insert failed for ${url}`);
        }
      }
    }
  }

  logger.info({ newCount, purgedCount, errorCount: errors.length }, "Fetch complete");
  return { newCount, purgedCount, errors };
}
