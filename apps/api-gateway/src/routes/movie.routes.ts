import { Router } from "express";
import * as movieController from "../controllers/movie.controller";

const router = Router();

router.get("/home", movieController.home);
router.get("/", movieController.index);
router.get("/:id", movieController.show);
router.post("/", movieController.create);
router.post("/progress", movieController.progress);
router.get("/progress", movieController.getProgress);

export default router;
