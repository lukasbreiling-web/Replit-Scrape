# Snapshot News Aggregator

A full-stack news caching app that scrapes RSS feeds, saves article HTML locally, and lets you permanently bookmark articles before they auto-expire after 3 days.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/snapshot-news run dev` — run the frontend (port 24788)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- RSS parsing: `rss-parser`
- Frontend: React + Vite, TanStack Query, shadcn/ui, Tailwind CSS

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/articles.ts` — articles table schema
- `artifacts/api-server/src/routes/articles.ts` — article CRUD + toggle-save + stats endpoints
- `artifacts/api-server/src/lib/rss-fetcher.ts` — RSS scraping, HTML caching, 3-day purge logic
- `artifacts/snapshot-news/src/` — React frontend
- `cached_articles/` — local directory where article HTML files are saved

## Architecture decisions

- RSS feeds used: BBC Top Stories, Hacker News, Reuters
- Articles are cached as raw HTML in `cached_articles/` with sanitized filenames
- Auto-purge runs before every fetch: deletes DB rows + local files older than 3 days where `is_saved = false`
- Saved articles are never auto-purged regardless of age
- Frontend splits articles into "Current Feed" (temporary) and "Saved Library" columns
- Expiry badges show hours/days remaining before an unsaved article is purged

## Product

- RSS feed aggregation from 3 sources (BBC, Hacker News, Reuters)
- Article HTML caching with automatic 3-day expiry for unsaved articles
- Permanent save/unsave toggle per article
- Publisher color-coded badges
- Stats header showing total cached count
- Relative timestamps and expiry countdown on temporary articles

## Gotchas

- After adding new schema tables, always run `pnpm run typecheck:libs` before typechecking api-server
- `cached_articles/` directory is created automatically on first fetch
- Some RSS sources may return 403 if fetched too aggressively (User-Agent header is set)
- Reuters feed URL may change — verify at https://www.reuters.com/tools/rss if needed

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
