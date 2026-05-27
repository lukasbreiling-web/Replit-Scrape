import { Router } from "express";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const SCRAPER_SCRIPT = path.join(WORKSPACE_ROOT, "scripts", "scraper.py");

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
