import { useQueryClient } from "@tanstack/react-query";
import { Rss, RefreshCw } from "lucide-react";
import { 
  useListArticles, 
  useFetchArticles, 
  useToggleSave, 
  useGetArticleStats,
  getListArticlesQueryKey,
  getGetArticleStatsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ArticleCard } from "@/components/ArticleCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

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
          description: `Fetched ${result.newCount} new articles, purged ${result.purgedCount}.`,
        });
      },
      onError: (error) => {
        toast({
          title: "Refresh Failed",
          description: "Failed to fetch new articles.",
          variant: "destructive"
        });
      }
    }
  });

  const toggleSave = useToggleSave({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListArticlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArticleStatsQueryKey() });
      }
    }
  });

  const handleRefresh = () => {
    fetchArticles.mutate();
  };

  const currentFeed = articles?.filter(a => !a.isSaved) || [];
  const savedLibrary = articles?.filter(a => a.isSaved) || [];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Rss className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-serif font-bold tracking-tight">Snapshot</h1>
            {!isStatsLoading && stats && (
              <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider ml-2 bg-secondary/50">
                {stats.total} Cached
              </Badge>
            )}
          </div>
          <Button 
            onClick={handleRefresh} 
            disabled={fetchArticles.isPending}
            variant="outline"
            size="sm"
            className="font-mono text-xs h-8 border-border"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${fetchArticles.isPending ? 'animate-spin' : ''}`} />
            Scrape
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Current Feed Column */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">Current Feed</h2>
              <span className="text-xs font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded-sm">
                {currentFeed.length}
              </span>
            </div>

            {isArticlesLoading ? (
              <div className="flex flex-col gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-32 w-full bg-card-border" />
                ))}
              </div>
            ) : currentFeed.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border rounded-md bg-card/20">
                <p className="text-sm font-mono text-muted-foreground">No current articles.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {currentFeed.map(article => (
                  <ArticleCard 
                    key={article.id} 
                    article={article} 
                    onToggleSave={(id) => toggleSave.mutate({ id })}
                    isSaving={toggleSave.isPending && toggleSave.variables?.id === article.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Saved Library Column */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">Saved Library</h2>
              <span className="text-xs font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded-sm">
                {savedLibrary.length}
              </span>
            </div>

            {isArticlesLoading ? (
              <div className="flex flex-col gap-4">
                {[1, 2].map(i => (
                  <Skeleton key={i} className="h-32 w-full bg-card-border" />
                ))}
              </div>
            ) : savedLibrary.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border rounded-md bg-card/20">
                <p className="text-sm font-mono text-muted-foreground">Library is empty.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {savedLibrary.map(article => (
                  <ArticleCard 
                    key={article.id} 
                    article={article} 
                    onToggleSave={(id) => toggleSave.mutate({ id })}
                    isSaving={toggleSave.isPending && toggleSave.variables?.id === article.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
