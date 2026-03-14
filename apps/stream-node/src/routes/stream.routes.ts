import { Router } from "express";
import { stream } from "../controllers/stream.controller";

const router = Router();

router.get("/:blobId", stream);

export default router;
