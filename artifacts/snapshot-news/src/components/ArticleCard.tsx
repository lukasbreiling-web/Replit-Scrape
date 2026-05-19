import { formatDistanceToNow, differenceInHours } from "date-fns";
import { Bookmark, BookmarkX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Article } from "@workspace/api-client-react/src/generated/api.schemas";

interface ArticleCardProps {
  article: Article;
  onToggleSave: (id: number) => void;
  isSaving: boolean;
}

function getPublisherColor(publisher: string): string {
  const normalized = publisher.toLowerCase();
  if (normalized.includes("bbc")) return "bg-red-900 text-red-100 border-red-800";
  if (normalized.includes("hacker news")) return "bg-orange-900 text-orange-100 border-orange-800";
  if (normalized.includes("reuters")) return "bg-blue-900 text-blue-100 border-blue-800";
  return "bg-slate-800 text-slate-300 border-slate-700";
}

export function ArticleCard({ article, onToggleSave, isSaving }: ArticleCardProps) {
  const publisherColor = getPublisherColor(article.publisher);
  
  const fetchedDate = new Date(article.fetchedAt);
  const timeAgo = formatDistanceToNow(fetchedDate, { addSuffix: true });
  
  const expiryDate = new Date(fetchedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const hoursUntilExpiry = differenceInHours(expiryDate, new Date());
  
  const isExpiringSoon = hoursUntilExpiry <= 24 && hoursUntilExpiry > 0;
  
  const linkHref = article.cacheFilename 
    ? `/api/cached_articles/${article.cacheFilename}`
    : article.url;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-md bg-card border border-card-border shadow-sm group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-xs font-mono rounded-sm border ${publisherColor}`}>
              {article.publisher}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">{timeAgo}</span>
          </div>
          
          <a 
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg md:text-xl font-serif font-medium leading-snug hover:text-primary transition-colors line-clamp-3"
          >
            {article.headline}
          </a>
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/50">
        <div className="flex items-center">
          {!article.isSaved && hoursUntilExpiry > 0 && (
            <span className={`text-xs font-mono px-2 py-1 rounded ${isExpiringSoon ? 'bg-amber-900/50 text-amber-200 border border-amber-800/50' : 'text-muted-foreground'}`}>
              Expires in {hoursUntilExpiry}h
            </span>
          )}
          {!article.isSaved && hoursUntilExpiry <= 0 && (
            <span className="text-xs font-mono text-destructive">Expired</span>
          )}
        </div>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => onToggleSave(article.id)}
          disabled={isSaving}
          className="h-8 px-2 text-xs font-mono hover:bg-secondary"
        >
          {article.isSaved ? (
            <>
              <BookmarkX className="w-4 h-4 mr-1.5" />
              Unsave
            </>
          ) : (
            <>
              <Bookmark className="w-4 h-4 mr-1.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
