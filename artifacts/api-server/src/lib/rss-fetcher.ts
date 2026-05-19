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

const RSS_FEEDS = [
  { url: "http://feeds.bbci.co.uk/news/rss.xml", publisher: "BBC" },
  { url: "https://news.ycombinator.com/rss", publisher: "Hacker News" },
  { url: "https://feeds.reuters.com/reuters/topNews", publisher: "Reuters" },
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

export async function fetchAndCacheArticles(): Promise<{ newCount: number; purgedCount: number }> {
  await ensureCacheDir();
  const purgedCount = await purgeOldArticles();

  const parser = new Parser({ timeout: 10000 });
  let newCount = 0;

  for (const feed of RSS_FEEDS) {
    let items: Parser.Item[] = [];
    try {
      const parsed = await parser.parseURL(feed.url);
      items = parsed.items ?? [];
    } catch (err) {
      logger.warn({ err, feedUrl: feed.url }, "Failed to parse RSS feed");
      continue;
    }

    for (const item of items.slice(0, 20)) {
      const url = item.link ?? item.guid;
      const headline = item.title;
      if (!url || !headline) continue;

      const existing = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.url, url))
        .limit(1);

      if (existing.length > 0) continue;

      let cachePath: string | null = null;
      let cacheFilename: string | null = null;

      try {
        const filename = sanitizeFilename(headline);
        const filePath = path.join(CACHE_DIR, filename);

        const response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const html = await response.text();
          await fsPromises.writeFile(filePath, html, "utf-8");
          cachePath = filePath;
          cacheFilename = filename;
        }
      } catch (err) {
        logger.warn({ err, url }, "Failed to fetch/cache article HTML");
      }

      try {
        await db.insert(articlesTable).values({
          headline,
          publisher: feed.publisher,
          url,
          cachePath,
          cacheFilename,
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
