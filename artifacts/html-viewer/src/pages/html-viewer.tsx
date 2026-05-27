import { useState, useRef } from "react";
import { Globe, Loader2, AlertCircle, X, ExternalLink } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/html-viewer\/?$/, "").replace(/\/$/, "");

async function scrapeUrl(url: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/scrape-html`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.text();
}

export default function HtmlViewer() {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = inputUrl.trim();
    if (!url) return;

    setLoading(true);
    setError(null);
    setHtmlContent(null);

    try {
      const html = await scrapeUrl(url);
      setHtmlContent(html);
      setActiveUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setHtmlContent(null);
    setActiveUrl("");
    setError(null);
    setInputUrl("");
  };

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0f] text-[#e8e8ea] font-mono">
      {/* ── Header ── */}
      <header className="shrink-0 border-b border-[#222226] bg-[#111113] px-4 py-3 flex items-center gap-3">
        <Globe className="w-4 h-4 text-[#6c8eff] shrink-0" />
        <span className="text-sm font-semibold tracking-widest uppercase text-[#6c8eff]">
          HTML Viewer
        </span>
        <span className="text-[#333337] text-xs hidden sm:block">·</span>
        <span className="text-[10px] text-[#55555a] hidden sm:block tracking-wider">
          curl-powered scraper
        </span>
      </header>

      {/* ── URL bar ── */}
      <div className="shrink-0 border-b border-[#222226] bg-[#111113] px-4 py-3">
        <form onSubmit={handleScrape} className="flex items-center gap-2 max-w-4xl mx-auto">
          <div className="relative flex-1">
            <input
              type="url"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://example.com"
              required
              disabled={loading}
              className="w-full bg-[#18181c] border border-[#2a2a30] rounded-sm px-3 py-2 text-sm text-[#e8e8ea] placeholder-[#444449] focus:outline-none focus:border-[#6c8eff] transition-colors disabled:opacity-50"
            />
            {(htmlContent || error) && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555559] hover:text-[#e8e8ea] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !inputUrl.trim()}
            className="flex items-center gap-2 bg-[#6c8eff] hover:bg-[#5a7aff] disabled:opacity-40 disabled:cursor-not-allowed text-[#0d0d0f] text-sm font-semibold px-4 py-2 rounded-sm transition-colors shrink-0"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Globe className="w-3.5 h-3.5" />
            )}
            {loading ? "Scraping…" : "Fetch"}
          </button>
        </form>

        {/* Active URL chip */}
        {activeUrl && htmlContent && (
          <div className="flex items-center gap-2 mt-2 max-w-4xl mx-auto">
            <span className="text-[10px] text-[#55555a] tracking-wider uppercase">Loaded</span>
            <a
              href={activeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-[#6c8eff] hover:underline truncate max-w-xs"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {activeUrl}
            </a>
          </div>
        )}
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 overflow-hidden relative">
        {/* Empty state */}
        {!loading && !error && !htmlContent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
            <Globe className="w-10 h-10 text-[#333337]" />
            <div>
              <p className="text-sm text-[#55555a]">Enter a URL above and click Fetch</p>
              <p className="text-xs text-[#333337] mt-1">
                Uses <span className="text-[#6c8eff]">curl</span> with stealth headers to bypass bot detection
              </p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-[#6c8eff] animate-spin" />
            <p className="text-sm text-[#55555a]">Scraping with curl…</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <div className="flex flex-col items-center gap-3 max-w-md w-full">
              <AlertCircle className="w-8 h-8 text-[#ff6b6b]" />
              <div className="text-center">
                <p className="text-sm font-semibold text-[#ff6b6b]">Scrape Failed</p>
                <p className="text-xs text-[#55555a] mt-1 break-all">{error}</p>
              </div>
              <button
                onClick={handleClear}
                className="text-xs text-[#6c8eff] hover:underline"
              >
                Try another URL
              </button>
            </div>
          </div>
        )}

        {/* Iframe with scraped HTML */}
        {htmlContent && !loading && (
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="Scraped HTML"
            className="w-full h-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}
