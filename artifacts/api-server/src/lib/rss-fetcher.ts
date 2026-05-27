import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import Parser from "rss-parser";
import { db, articlesTable } from "@workspace/db";
import { lt, and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

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

// ── Paywall / challenge-page heuristics ───────────────────────────────────────
const PAYWALL_PATTERNS = [
  /subscribe to continue/i,
  /create a free account/i,
  /sign in to read/i,
  /this content is for subscribers/i,
  /access denied/i,
  /enable javascript/i,
  /just a moment/i,             // Cloudflare
  /checking your browser/i,     // Cloudflare / DDoS-GUARD
  /please turn javascript on/i,
];

function looksLikeBlockPage(html: string): boolean {
  if (html.length < 1500) return true;
  const snippet = html.slice(0, 6000).toLowerCase();
  return PAYWALL_PATTERNS.some((re) => re.test(snippet));
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

// Randomized delay: 600ms–2000ms between requests (reduced to not slow scrapes too much)
function randomDelay(minMs = 600, maxMs = 2000): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Path to the Python curl-based scraper script
const SCRAPER_SCRIPT = path.resolve(__dirname, "../../../../scripts/scraper.py");

// ── Fetch one article's HTML via the Python/curl scraper ─────────────────────
// Returns null on any failure — the caller always falls back to the RSS URL.
async function fetchArticleHtml(
  articleUrl: string,
  headline: string,
): Promise<{ cachePath: string; cacheFilename: string } | null> {
  try {
    const { stdout: html, stderr } = await execFileAsync(
      "python3",
      [SCRAPER_SCRIPT, articleUrl],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
    );

    if (stderr?.trim()) {
      // scraper.py writes JSON error objects to stderr — log them for diagnosis
      logger.warn({ url: articleUrl, scraperStderr: stderr.trim() }, "Scraper stderr");
    }

    if (!html) {
      logger.warn({ url: articleUrl }, "Scraper returned empty response — skipping cache");
      return null;
    }

    if (looksLikeBlockPage(html)) {
      logger.warn(
        { url: articleUrl, htmlLength: html.length },
        "Response looks like a block/paywall page — skipping cache",
      );
      return null;
    }

    const filename = sanitizeFilename(headline);
    const filePath = path.join(CACHE_DIR, filename);
    await fsPromises.writeFile(filePath, html, "utf-8");
    logger.info({ url: articleUrl, filename }, "Cached article HTML");
    return { cachePath: filePath, cacheFilename: filename };
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && err.message.toLowerCase().includes("timeout");
    const isExitError =
      err instanceof Error && "code" in err && typeof (err as { code?: unknown }).code === "number";
    const exitCode = isExitError ? (err as { code: number }).code : undefined;

    if (isTimeout) {
      logger.warn({ url: articleUrl }, "Scraper timed out — falling back to RSS URL");
    } else if (exitCode !== undefined) {
      logger.warn(
        { url: articleUrl, exitCode },
        "Scraper exited with non-zero code — falling back to RSS URL",
      );
    } else {
      logger.warn({ err, url: articleUrl }, "Scraper error — falling back to RSS URL");
    }
    return null;
  }
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
  await ensureCacheDir();
  const purgedCount = await purgeOldArticles();

  const rssParser = new Parser({
    timeout: 18000,
    headers: {
      "User-Agent": randomUA(),
      Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
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
      const headline = (item.title ?? item.contentSnippet ?? "Untitled").trim();

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

      // Human-like delay before each HTML fetch
      await randomDelay();

      // Try to cache full HTML; gracefully fall back to null if blocked/failed
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
        logger.info(
          { headline: headline.slice(0, 60), publisher: source.publisher, cached: !!cached },
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
