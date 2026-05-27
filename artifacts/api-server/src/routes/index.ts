import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import scrapeRouter from "./scrape";

const router: IRouter = Router();

router.use(healthRouter);
router.use(articlesRouter);
router.use(scrapeRouter);

export default router;
