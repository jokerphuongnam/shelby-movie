import { Router } from "express";
import * as accessController from "../controllers/access.controller";

const router = Router();

router.get("/history", accessController.history);
router.post("/watched", accessController.markWatched);
router.post("/free", accessController.free);
router.post("/preview", accessController.preview);

export default router;
