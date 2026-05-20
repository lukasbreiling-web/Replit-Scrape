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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// The two publications we track
const PUBLICATIONS = ["SF Chronicle", "The Press Democrat"] as const;
type Publication = (typeof PUBLICATIONS)[number];

const PUB_CONFIG: Record<
  Publication,
  { accent: string; label: string; borderColor: string; dotColor: string }
> = {
  "SF Chronicle": {
    label: "SF Chronicle",
    accent: "text-sky-400",
    borderColor: "border-sky-700/40",
    dotColor: "bg-sky-400",
  },
  "The Press Democrat": {
    label: "The Press Democrat",
    accent: "text-emerald-400",
    borderColor: "border-emerald-700/40",
    dotColor: "bg-emerald-400",
  },
};

function PublisherColumn({
  publisher,
  articles,
  isLoading,
  onToggleSave,
  isPendingId,
}: {
  publisher: Publication;
  articles: Article[] | undefined;
  isLoading: boolean;
  onToggleSave: (id: number) => void;
  isPendingId: number | undefined;
}) {
  const cfg = PUB_CONFIG[publisher];
  const filtered = (articles ?? ([] as Article[])).filter((a) => a.publisher === publisher);
  const savedCount = filtered.filter((a) => a.isSaved).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Column header */}
      <div className={`flex items-center justify-between pb-3 border-b ${cfg.borderColor}`}>
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotColor}`} />
          <h2 className={`text-sm font-mono font-semibold tracking-widest uppercase ${cfg.accent}`}>
            {cfg.label}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {savedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
              <BookMarked className="w-3 h-3" />
              {savedCount}
            </span>
          )}
          <span className="text-[11px] font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded-sm">
            {filtered.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-sm bg-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-border/50 rounded-sm bg-card/10">
          <Newspaper className="w-6 h-6 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-mono text-muted-foreground/60">No articles yet.</p>
          <p className="text-xs font-mono text-muted-foreground/40 mt-1">
            Hit Scrape to fetch the latest stories.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onToggleSave={onToggleSave}
              isSaving={isPendingId === article.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: articles, isLoading: isArticlesLoading } = useListArticles();
  const { data: stats, isLoading: isStatsLoading } = useGetArticleStats();

  const fetchArticles = useFetchArticles({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListArticlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArticleStatsQueryKey() });
        toast({
          title: "Feed Refreshed",
          description: `${result.newCount} new article${result.newCount !== 1 ? "s" : ""} fetched${result.purgedCount > 0 ? `, ${result.purgedCount} purged` : ""}.`,
        });
      },
      onError: () => {
        toast({
          title: "Refresh Failed",
          description: "Could not reach one or more sources.",
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

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-serif font-bold tracking-tight shrink-0">
              Snapshot
            </h1>
            <span className="hidden sm:block text-muted-foreground/40 font-mono text-xs">|</span>
            <span className="hidden sm:block text-xs font-mono text-muted-foreground/60 truncate">
              SF Bay Area News
            </span>

            {!isStatsLoading && stats && (
              <span
                data-testid="text-total-cached"
                className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground bg-secondary px-2 py-1 rounded-sm ml-2"
              >
                {stats.total} cached
                {stats.saved > 0 && (
                  <span className="text-primary">· {stats.saved} saved</span>
                )}
              </span>
            )}
          </div>

          <Button
            onClick={() => fetchArticles.mutate()}
            disabled={fetchArticles.isPending}
            data-testid="button-scrape"
            variant="outline"
            size="sm"
            className="font-mono text-xs h-8 border-border shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-2 ${fetchArticles.isPending ? "animate-spin" : ""}`}
            />
            {fetchArticles.isPending ? "Scraping…" : "Scrape"}
          </Button>
        </div>
      </header>

      {/* ── Publication notice ── */}
      <div className="border-b border-border/30 bg-black/20">
        <div className="max-w-6xl mx-auto px-5 py-2 flex items-center gap-4">
          {PUBLICATIONS.map((pub) => {
            const cfg = PUB_CONFIG[pub];
            const count = (articles ?? []).filter((a) => a.publisher === pub).length;
            return (
              <div key={pub} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
                <span className={`text-[11px] font-mono ${cfg.accent}`}>{cfg.label}</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">({count})</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Two-column publisher layout ── */}
      <main className="max-w-6xl mx-auto px-5 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
          {PUBLICATIONS.map((pub) => (
            <PublisherColumn
              key={pub}
              publisher={pub}
              articles={articles}
              isLoading={isArticlesLoading}
              onToggleSave={(id) => toggleSave.mutate({ id })}
              isPendingId={pendingId}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
