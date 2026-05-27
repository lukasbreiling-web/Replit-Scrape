import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRAPER_SCRIPT = path.resolve(__dirname, "../../../../scripts/scraper.py");

const router = Router();

router.post("/scrape-html", async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' in request body" });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  try {
    const { stdout } = await execFileAsync("python3", [SCRAPER_SCRIPT, url], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(stdout);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown scraper error";
    res.status(502).json({ error: `Scraper failed: ${message}` });
  }
});

export default router;
