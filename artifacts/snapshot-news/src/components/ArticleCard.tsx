import { formatDistanceToNow, differenceInHours } from "date-fns";
import { Bookmark, BookmarkX, ExternalLink, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Article } from "@workspace/api-client-react";

interface ArticleCardProps {
  article: Article;
  onToggleSave: (id: number) => void;
  isSaving: boolean;
}

export function ArticleCard({ article, onToggleSave, isSaving }: ArticleCardProps) {
  const fetchedDate = new Date(article.fetchedAt);
  const timeAgo = formatDistanceToNow(fetchedDate, { addSuffix: true });

  const expiryDate = new Date(fetchedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const hoursUntilExpiry = differenceInHours(expiryDate, new Date());
  const isExpiringSoon = !article.isSaved && hoursUntilExpiry <= 24 && hoursUntilExpiry > 0;

  const linkHref = article.cacheFilename
    ? `/api/cached_articles/${article.cacheFilename}`
    : article.url;

  return (
    <article
      data-testid={`article-card-${article.id}`}
      className={`
        group relative flex flex-col bg-card border rounded-sm overflow-hidden
        transition-shadow duration-200 hover:shadow-lg hover:shadow-black/30
        ${article.isSaved ? "border-primary/30 bg-primary/5" : "border-card-border"}
        ${isExpiringSoon ? "border-amber-800/40" : ""}
      `}
    >
      {/* Saved indicator stripe */}
      {article.isSaved && (
        <div className="absolute top-0 left-0 w-0.5 h-full bg-primary" />
      )}

      <div className="flex flex-col gap-3 p-5">
        {/* Meta row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="text-[11px] font-mono tracking-wide">{timeAgo}</span>
          </div>

          {isExpiringSoon && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/40 tracking-wider uppercase">
              Expires {hoursUntilExpiry}h
            </span>
          )}
          {article.isSaved && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/20 tracking-wider uppercase">
              Saved
            </span>
          )}
        </div>

        {/* Headline */}
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-article-${article.id}`}
          className="text-base md:text-[17px] font-serif font-semibold leading-snug text-foreground hover:text-primary transition-colors duration-150 line-clamp-3 group-hover:text-primary/90"
        >
          {article.headline}
        </a>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border/40 bg-black/10 mt-auto">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-external-${article.id}`}
          className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Original
        </a>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleSave(article.id)}
          disabled={isSaving}
          data-testid={`button-save-${article.id}`}
          className="h-7 px-2.5 text-[11px] font-mono tracking-wide hover:bg-secondary gap-1.5"
        >
          {article.isSaved ? (
            <>
              <BookmarkX className="w-3.5 h-3.5" />
              Unsave
            </>
          ) : (
            <>
              <Bookmark className="w-3.5 h-3.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </article>
  );
}
