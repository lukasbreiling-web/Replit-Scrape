import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Newspaper, BookMarked } from "lucide-react";
import {
  useListArticles,
  useFetchArticles,
  useToggleSave,
  useGetArticleStats,
  getListArticlesQueryKey,
  getGetArticleStatsQueryKey,
  type Article,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ArticleCard } from "@/components/ArticleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const PUBLICATIONS = ["SF Chronicle", "The Press Democrat"] as const;
type Publication = (typeof PUBLICATIONS)[number];
type Filter = "all" | Publication | "saved";

function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-0 mt-8 mb-4">
      <div className="flex-1 h-px bg-[#121212]" />
      <span className="px-3 text-[11px] font-bold tracking-[0.15em] uppercase text-[#121212] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-[#e2e2e2]" />
    </div>
  );
}

function SkeletonArticles({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="py-4 border-b border-[#e2e2e2] flex flex-col gap-2">
          <Skeleton className="h-3 w-20 bg-[#f0f0f0]" />
          <Skeleton className="h-5 w-full bg-[#f0f0f0]" />
          <Skeleton className="h-5 w-4/5 bg-[#f0f0f0]" />
          <Skeleton className="h-3 w-16 bg-[#f5f5f5]" />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const { data: articles, isLoading: isArticlesLoading } = useListArticles();
  const { data: stats, isLoading: isStatsLoading } = useGetArticleStats();

  const fetchArticles = useFetchArticles({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListArticlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArticleStatsQueryKey() });
        toast({
          title: "Feed Refreshed",
          description:
            `${result.newCount} new article${result.newCount !== 1 ? "s" : ""} fetched` +
            (result.purgedCount > 0 ? `, ${result.purgedCount} purged` : "."),
        });
      },
      onError: () => {
        toast({
          title: "Refresh Failed",
          description: "Could not reach one or more sources. Check the server logs.",
          variant: "destructive",
        });
      },
    },
  });

  const toggleSave = useToggleSave({
    mutation: {
      onSuccess: (article) => {
        queryClient.invalidateQueries({ queryKey: getListArticlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArticleStatsQueryKey() });
        toast({
          title: article.isSaved ? "Article Saved" : "Article Unsaved",
          description: article.isSaved
            ? "Moved to your permanent library."
            : "Removed from library — will expire in 3 days.",
        });
      },
    },
  });

  const pendingId =
    toggleSave.isPending && toggleSave.variables
      ? (toggleSave.variables as { id: number }).id
      : undefined;

  const handleSave = (id: number) => toggleSave.mutate({ id });

  // Filter articles
  const allArticles: Article[] = articles ?? [];
  const visibleArticles =
    filter === "all"
      ? allArticles
      : filter === "saved"
      ? allArticles.filter((a) => a.isSaved)
      : allArticles.filter((a) => a.publisher === filter);

  // Split for layout
  const leadArticle = visibleArticles[0];
  const sidebarArticles = visibleArticles.slice(1, 4);
  const remainingArticles = visibleArticles.slice(4);

  // For the "more stories" section — split by publisher
  const chronicleMore = remainingArticles.filter((a) => a.publisher === "SF Chronicle");
  const pressdemMore = remainingArticles.filter((a) => a.publisher === "The Press Democrat");

  // Today's date in NYT format
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-white text-[#121212]" style={{ fontFamily: "Franklin Gothic Medium, Arial Narrow, Arial, sans-serif" }}>

      {/* ── Top utility bar ── */}
      <div className="border-b border-[#e2e2e2]">
        <div className="max-w-5xl mx-auto px-4 h-9 flex items-center justify-between text-[11px] text-[#666]">
          <span>{today}</span>
          <div className="flex items-center gap-4">
            {!isStatsLoading && stats && (
              <span data-testid="text-total-cached">
                {stats.total} articles cached
                {stats.saved > 0 && (
                  <span className="text-[#d0021b] ml-1">· {stats.saved} saved</span>
                )}
              </span>
            )}
            <button
              onClick={() => fetchArticles.mutate()}
              disabled={fetchArticles.isPending}
              data-testid="button-scrape"
              className="flex items-center gap-1.5 text-[11px] tracking-wide text-[#666] hover:text-[#121212] disabled:opacity-40 transition-colors border-l border-[#e2e2e2] pl-4"
            >
              <RefreshCw
                className={`w-3 h-3 ${fetchArticles.isPending ? "animate-spin" : ""}`}
              />
              {fetchArticles.isPending ? "Scraping…" : "Scrape"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Masthead ── */}
      <div className="border-b-4 border-[#121212]">
        <div className="max-w-5xl mx-auto px-4 py-5 text-center">
          <h1
            className="text-[3.5rem] leading-none tracking-tight text-[#121212] select-none"
            style={{ fontFamily: "Georgia, 'Times New Roman', Times, serif", fontWeight: 700 }}
          >
            Snapshot
          </h1>
          <p className="text-[11px] tracking-[0.25em] uppercase text-[#888] mt-1">
            SF Bay Area News Aggregator
          </p>
        </div>
      </div>

      {/* ── Section nav ── */}
      <div className="border-b border-[#e2e2e2] sticky top-0 bg-white z-20">
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex items-center gap-0 overflow-x-auto">
            {(["all", "SF Chronicle", "The Press Democrat", "saved"] as const).map((f) => {
              const label =
                f === "all"
                  ? "All Stories"
                  : f === "saved"
                  ? `Saved${stats?.saved ? ` (${stats.saved})` : ""}`
                  : f;
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`
                    px-4 py-3 text-[12px] tracking-[0.08em] uppercase shrink-0 border-b-2 transition-colors
                    ${isActive
                      ? "border-[#d0021b] text-[#d0021b] font-bold"
                      : "border-transparent text-[#666] hover:text-[#121212]"
                    }
                  `}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 pb-16">

        {/* ── Loading state ── */}
        {isArticlesLoading && (
          <>
            <SectionRule label="Top Stories" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
              <div className="md:col-span-2 md:pr-8 md:border-r border-[#e2e2e2]">
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-24 bg-[#f0f0f0]" />
                  <Skeleton className="h-10 w-full bg-[#f0f0f0]" />
                  <Skeleton className="h-10 w-5/6 bg-[#f0f0f0]" />
                  <Skeleton className="h-8 w-4/6 bg-[#f0f0f0]" />
                </div>
              </div>
              <div className="md:col-span-1 md:pl-8">
                <SkeletonArticles count={3} />
              </div>
            </div>
          </>
        )}

        {/* ── Empty state ── */}
        {!isArticlesLoading && visibleArticles.length === 0 && (
          <div className="py-24 text-center">
            <Newspaper className="w-8 h-8 text-[#bbb] mx-auto mb-4" />
            <p className="text-[15px] font-serif text-[#888]">
              {filter === "saved" ? "No saved articles." : "No articles yet."}
            </p>
            <p className="text-[12px] text-[#aaa] mt-1">
              {filter === "saved"
                ? "Bookmark stories to save them here."
                : "Click Scrape in the top bar to fetch the latest stories."}
            </p>
            {filter !== "all" && (
              <button
                onClick={() => setFilter("all")}
                className="mt-4 text-[12px] text-[#d0021b] underline underline-offset-2"
              >
                View all stories
              </button>
            )}
          </div>
        )}

        {/* ── TOP STORIES ── */}
        {!isArticlesLoading && leadArticle && (
          <>
            <SectionRule label="Top Stories" />

            {/* Lead + Sidebar grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
              {/* Lead article */}
              <div className="md:col-span-2 md:pr-8 md:border-r border-[#e2e2e2] pb-8 md:pb-0">
                <ArticleCard
                  article={leadArticle}
                  onToggleSave={handleSave}
                  isSaving={pendingId === leadArticle.id}
                  variant="lead"
                />
              </div>

              {/* Sidebar articles */}
              <div className="md:col-span-1 md:pl-8 border-t border-[#e2e2e2] md:border-t-0">
                {sidebarArticles.length === 0 && (
                  <p className="text-[12px] text-[#aaa] pt-4">No more articles in this view.</p>
                )}
                {sidebarArticles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onToggleSave={handleSave}
                    isSaving={pendingId === article.id}
                    variant="secondary"
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── MORE STORIES by publication ── */}
        {!isArticlesLoading && remainingArticles.length > 0 && (
          <>
            {/* SF Chronicle section */}
            {chronicleMore.length > 0 && (
              <>
                <SectionRule label="More from SF Chronicle" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-0">
                  {chronicleMore.map((article) => (
                    <div key={article.id} className="md:pr-6">
                      <ArticleCard
                        article={article}
                        onToggleSave={handleSave}
                        isSaving={pendingId === article.id}
                        variant="grid"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Press Democrat section */}
            {pressdemMore.length > 0 && (
              <>
                <SectionRule label="More from The Press Democrat" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-0">
                  {pressdemMore.map((article) => (
                    <div key={article.id} className="md:pr-6">
                      <ArticleCard
                        article={article}
                        onToggleSave={handleSave}
                        isSaving={pendingId === article.id}
                        variant="grid"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Saved indicator ── */}
        {!isArticlesLoading && filter !== "saved" && stats && stats.saved > 0 && (
          <div className="mt-10 pt-6 border-t border-[#e2e2e2] flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] text-[#888]">
              <BookMarked className="w-3.5 h-3.5" />
              {stats.saved} article{stats.saved !== 1 ? "s" : ""} in your library
            </div>
            <button
              onClick={() => setFilter("saved")}
              className="text-[12px] text-[#d0021b] underline underline-offset-2"
            >
              View saved
            </button>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t-4 border-[#121212]">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center text-[11px] text-[#888] tracking-wider uppercase">
          Snapshot · SF Bay Area · Sources: SF Chronicle, The Press Democrat
        </div>
      </footer>
    </div>
  );
}
