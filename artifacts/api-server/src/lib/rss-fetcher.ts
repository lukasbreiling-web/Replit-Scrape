import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { db, articlesTable } from "@workspace/db";
import { lt, and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// process.cwd() = artifacts/api-server/ (where the server is started from)
// Go up two levels to reach the workspace root
const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const CACHE_DIR = path.join(WORKSPACE_ROOT, "cached_articles");
const SCRAPER_SCRIPT = path.join(WORKSPACE_ROOT, "scripts", "scraper.py");
const PARSE_SCRIPT = path.join(WORKSPACE_ROOT, "scripts", "parse_articles.py");

// ── Sources ──────────────────────────────────────────────────────────────────
// Fetched directly from publisher homepages — no intermediary.
// articleUrlPattern is a regex matched against each href to identify articles.
const SOURCES = [
  {
    publisher: "Press Democrat",
    homepageUrl: "https://www.pressdemocrat.com/",
    // Articles follow the pattern /YYYY/MM/DD/slug/
    articleUrlPattern: "pressdemocrat\\.com/\\d{4}/\\d{2}/\\d{2}/[^/?#]{5,}",
  },
  {
    publisher: "Mission Local",
    homepageUrl: "https://missionlocal.org/",
    // Articles: /YYYY/MM/slug/
    articleUrlPattern: "missionlocal\\.org/\\d{4}/\\d{2}/[^/?#]{5,}",
  },
  {
    publisher: "SF Gate",
    homepageUrl: "https://www.sfgate.com/",
    // Articles: /SECTION/article/SLUG-HASHID/
    articleUrlPattern: "sfgate\\.com/[a-z-]+/article/[a-z0-9-]{10,}",
  },
  {
    publisher: "Berkeleyside",
    homepageUrl: "https://www.berkeleyside.org/",
    // Articles: /YYYY/MM/DD/slug/
    articleUrlPattern: "berkeleyside\\.org/\\d{4}/\\d{2}/\\d{2}/[^/?#]{5,}",
  },
];

// ── Paywall / challenge-page heuristics ───────────────────────────────────────
const PAYWALL_PATTERNS = [
  /subscribe to continue/i,
  /create a free account/i,
  /sign in to read/i,
  /this content is for subscribers/i,
  /access denied/i,
  /enable javascript/i,
  /just a moment/i,
  /checking your browser/i,
  /please turn javascript on/i,
  /client challenge/i,
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

function randomDelay(minMs = 800, maxMs = 2500): Promise<void> {
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

// ── Step 1: Get article list from publisher homepage ──────────────────────────
interface ArticleLink {
  url: string;
  headline: string;
}

async function fetchArticleList(
  homepageUrl: string,
  urlPattern: string,
  publisher: string,
): Promise<ArticleLink[]> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "python3",
      [PARSE_SCRIPT, homepageUrl, urlPattern],
      { maxBuffer: 20 * 1024 * 1024, timeout: 35000 },
    );

    if (stderr?.trim()) {
      logger.warn({ publisher, stderr: stderr.trim() }, "parse_articles stderr");
    }

    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed)) {
      logger.warn({ publisher, parsed }, "parse_articles returned non-array");
      return [];
    }

    logger.info({ publisher, count: parsed.length }, "Article list fetched from homepage");
    return parsed as ArticleLink[];
  } catch (err) {
    logger.warn({ err, publisher, homepageUrl }, "Failed to fetch article list");
    return [];
  }
}

// ── Step 2: Fetch and cache HTML for a single article ─────────────────────────
async function fetchArticleHtml(
  articleUrl: string,
  headline: string,
  homepageUrl: string,
): Promise<{ cachePath: string; cacheFilename: string } | null> {
  try {
    // Pass the publisher homepage as referer — helps bypass paywalls
    const { stdout: html, stderr } = await execFileAsync(
      "python3",
      [SCRAPER_SCRIPT, articleUrl, homepageUrl],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
    );

    if (stderr?.trim()) {
      logger.warn({ url: articleUrl, scraperStderr: stderr.trim() }, "Scraper stderr");
    }

    if (!html) {
      logger.warn({ url: articleUrl }, "Scraper returned empty response — skipping");
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
    const exitCode =
      err instanceof Error && "code" in err && typeof (err as { code?: unknown }).code === "number"
        ? (err as { code: number }).code
        : undefined;

    if (isTimeout) {
      logger.warn({ url: articleUrl }, "Scraper timed out");
    } else if (exitCode !== undefined) {
      logger.warn({ url: articleUrl, exitCode }, "Scraper non-zero exit");
    } else {
      logger.warn({ err, url: articleUrl }, "Scraper error");
    }
    return null;
  }
}

// ── Main fetch orchestrator ───────────────────────────────────────────────────
export async function fetchAndCacheArticles(): Promise<{
  newCount: number;
  purgedCount: number;
  errors: string[];
}> {
  await ensureCacheDir();
  const purgedCount = await purgeOldArticles();

  let newCount = 0;
  const errors: string[] = [];

  for (const source of SOURCES) {
    logger.info({ publisher: source.publisher }, "Processing source");

    // ── 1. Get article list from publisher homepage ──
    const articles = await fetchArticleList(
      source.homepageUrl,
      source.articleUrlPattern,
      source.publisher,
    );

    if (articles.length === 0) {
      const msg = `No articles found on ${source.publisher} homepage`;
      logger.warn({ publisher: source.publisher }, msg);
      errors.push(msg);
      continue;
    }

    // ── 2. Process each article ──
    for (const { url, headline } of articles.slice(0, 20)) {
      if (!url || !headline) continue;

      try {
        new URL(url);
      } catch {
        logger.warn({ url }, "Malformed article URL — skipping");
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
        logger.error({ err, url }, "DB dedup check failed — skipping");
        errors.push(`DB error for ${url}`);
        continue;
      }

      // Human-like delay between fetches
      await randomDelay();

      // Fetch and cache the article HTML
      const cached = await fetchArticleHtml(url, headline, source.homepageUrl);

      try {
        await db.insert(articlesTable).values({
          headline,
          publisher: source.publisher,
          url,
          description: null,
          publishedAt: null,
          cachePath: cached?.cachePath ?? null,
          cacheFilename: cached?.cacheFilename ?? null,
          isSaved: false,
        });
        newCount++;
        logger.info(
          {
            headline: headline.slice(0, 60),
            publisher: source.publisher,
            cached: !!cached,
          },
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
