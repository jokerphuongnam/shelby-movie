import { Router } from "express";
import multer from "multer";
import * as uploadController from "../controllers/upload.controller";

// Store chunks in memory — for production consider disk storage for very large files
const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post("/commitments", upload.single("video"), uploadController.commitments);
router.post("/register", uploadController.register);
router.post("/chunk", upload.single("chunk"), uploadController.chunk);

export default router;
