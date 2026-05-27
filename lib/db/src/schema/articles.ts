import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  publisher: text("publisher").notNull(),
  url: text("url").notNull().unique(),
  description: text("description"),
  publishedAt: timestamp("published_at"),
  cachePath: text("cache_path"),
  cacheFilename: text("cache_filename"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  isSaved: boolean("is_saved").default(false).notNull(),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({ id: true, fetchedAt: true });
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
