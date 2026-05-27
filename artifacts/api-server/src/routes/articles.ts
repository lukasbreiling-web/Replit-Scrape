import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import fsPromises from "fs/promises";
import { db, articlesTable } from "@workspace/db";
import { eq, desc, lt, and, count, sql } from "drizzle-orm";
import { fetchAndCacheArticles } from "../lib/rss-fetcher.js";
import {
  ToggleSaveParams,
} from "@workspace/api-zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, "../../../../cached_articles");

const router = Router();

router.get("/articles", async (req, res) => {
  const articles = await db
    .select()
    .from(articlesTable)
    .orderBy(desc(articlesTable.fetchedAt));
  res.json(articles);
});

router.post("/articles/fetch", async (req, res) => {
  try {
    const { newCount, purgedCount, errors } = await fetchAndCacheArticles();
    const articles = await db
      .select()
      .from(articlesTable)
      .orderBy(desc(articlesTable.fetchedAt));
    res.json({ articles, newCount, purgedCount, errors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    res.status(500).json({ error: `Fetch failed: ${message}`, articles: [], newCount: 0, purgedCount: 0, errors: [message] });
  }
});

router.post("/articles/:id/toggle-save", async (req, res) => {
  const parsed = ToggleSaveParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }
  const { id } = parsed.data;

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, id))
    .limit(1);

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const [updated] = await db
    .update(articlesTable)
    .set({ isSaved: !article.isSaved })
    .where(eq(articlesTable.id, id))
    .returning();

  res.json(updated);
});

router.get("/articles/stats", async (req, res) => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiryThreshold = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const [totalRow] = await db
    .select({ value: count() })
    .from(articlesTable);

  const [savedRow] = await db
    .select({ value: count() })
    .from(articlesTable)
    .where(eq(articlesTable.isSaved, true));

  const [tempRow] = await db
    .select({ value: count() })
    .from(articlesTable)
    .where(eq(articlesTable.isSaved, false));

  const [expiringSoonRow] = await db
    .select({ value: count() })
    .from(articlesTable)
    .where(
      and(
        eq(articlesTable.isSaved, false),
        lt(articlesTable.fetchedAt, expiryThreshold),
      ),
    );

  res.json({
    total: Number(totalRow?.value ?? 0),
    saved: Number(savedRow?.value ?? 0),
    temporary: Number(tempRow?.value ?? 0),
    expiringSoon: Number(expiringSoonRow?.value ?? 0),
  });
});

router.get("/cached_articles/:filename", async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CACHE_DIR, filename);
  try {
    await fsPromises.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: "Cached file not found" });
  }
});

export default router;
