import { formatDistanceToNow, differenceInHours } from "date-fns";
import { Bookmark, BookmarkX, ExternalLink } from "lucide-react";
import { Article } from "@workspace/api-client-react";

interface ArticleCardProps {
  article: Article;
  onToggleSave: (id: number) => void;
  isSaving: boolean;
  variant?: "lead" | "secondary" | "grid";
}

const PUB_LABEL: Record<string, string> = {
  "SF Chronicle": "SF CHRONICLE",
  "The Press Democrat": "PRESS DEMOCRAT",
};

const PUB_COLOR: Record<string, string> = {
  "SF Chronicle": "#d0021b",
  "The Press Democrat": "#326891",
};

export function ArticleCard({
  article,
  onToggleSave,
  isSaving,
  variant = "grid",
}: ArticleCardProps) {
  const fetchedDate = new Date(article.fetchedAt);
  const timeAgo = formatDistanceToNow(fetchedDate, { addSuffix: true });
  const expiryDate = new Date(fetchedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const hoursUntilExpiry = differenceInHours(expiryDate, new Date());
  const isExpiringSoon = !article.isSaved && hoursUntilExpiry <= 24 && hoursUntilExpiry > 0;

  const linkHref = article.cacheFilename
    ? `/api/cached_articles/${article.cacheFilename}`
    : article.url;

  const pubLabel = PUB_LABEL[article.publisher] ?? article.publisher.toUpperCase();
  const pubColor = PUB_COLOR[article.publisher] ?? "#666";

  if (variant === "lead") {
    return (
      <article
        data-testid={`article-card-${article.id}`}
        className="group flex flex-col gap-3"
      >
        {/* Section tag */}
        <div className="flex items-center justify-between">
          <span
            className="text-[11px] font-bold tracking-[0.12em] uppercase"
            style={{ color: pubColor }}
          >
            {pubLabel}
          </span>
          {article.isSaved && (
            <span className="text-[10px] tracking-widest uppercase text-[#888]">Saved</span>
          )}
        </div>

        {/* Lead headline */}
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-article-${article.id}`}
          className="block font-serif text-[2rem] leading-[1.1] font-bold text-[#121212] hover:text-[#d0021b] transition-colors duration-100 line-clamp-4"
        >
          {article.headline}
        </a>

        {/* Meta */}
        <div className="flex items-center justify-between pt-1 border-t border-[#e2e2e2]">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#666]">{timeAgo}</span>
            {isExpiringSoon && (
              <span className="text-[10px] uppercase tracking-wider text-[#d0021b]">
                Expires {hoursUntilExpiry}h
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`link-external-${article.id}`}
              className="flex items-center gap-1 text-[11px] text-[#888] hover:text-[#121212] transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Original
            </a>
            <button
              onClick={() => onToggleSave(article.id)}
              disabled={isSaving}
              data-testid={`button-save-${article.id}`}
              className="flex items-center gap-1 text-[11px] text-[#888] hover:text-[#121212] transition-colors disabled:opacity-40"
            >
              {article.isSaved ? (
                <><BookmarkX className="w-3 h-3" />Unsave</>
              ) : (
                <><Bookmark className="w-3 h-3" />Save</>
              )}
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (variant === "secondary") {
    return (
      <article
        data-testid={`article-card-${article.id}`}
        className="group flex flex-col gap-2 py-4 border-b border-[#e2e2e2] last:border-b-0"
      >
        <span
          className="text-[10px] font-bold tracking-[0.12em] uppercase"
          style={{ color: pubColor }}
        >
          {pubLabel}
        </span>

        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-article-${article.id}`}
          className="block font-serif text-[1.1rem] leading-[1.25] font-semibold text-[#121212] hover:text-[#d0021b] transition-colors duration-100 line-clamp-3"
        >
          {article.headline}
        </a>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#888]">{timeAgo}</span>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onToggleSave(article.id)}
              disabled={isSaving}
              data-testid={`button-save-${article.id}`}
              className="text-[10px] text-[#888] hover:text-[#121212] transition-colors disabled:opacity-40"
            >
              {article.isSaved ? "Unsave" : "Save"}
            </button>
          </div>
        </div>
      </article>
    );
  }

  // grid variant
  return (
    <article
      data-testid={`article-card-${article.id}`}
      className="group flex flex-col gap-2 py-4 border-b border-[#e2e2e2]"
    >
      <span
        className="text-[10px] font-bold tracking-[0.12em] uppercase"
        style={{ color: pubColor }}
      >
        {pubLabel}
      </span>

      <a
        href={linkHref}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`link-article-${article.id}`}
        className="block font-serif text-[1rem] leading-[1.3] font-semibold text-[#121212] hover:text-[#d0021b] transition-colors duration-100 line-clamp-3"
      >
        {article.headline}
      </a>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#888]">{timeAgo}</span>
        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`link-external-${article.id}`}
            className="text-[10px] text-[#888] hover:text-[#121212] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={() => onToggleSave(article.id)}
            disabled={isSaving}
            data-testid={`button-save-${article.id}`}
            className="flex items-center gap-1 text-[10px] text-[#888] hover:text-[#121212] transition-colors disabled:opacity-40"
          >
            {article.isSaved ? (
              <><BookmarkX className="w-3 h-3" />Unsave</>
            ) : (
              <><Bookmark className="w-3 h-3" />Save</>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
