import { Router } from "express";
import multer from "multer";
import * as uploadController from "../controllers/upload.controller";

// Only the chunk endpoint needs multer — ceiling 25 MB; frontend sends ≤10 MB chunks.
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();

router.post("/commitments", uploadController.commitments);
router.post("/register", uploadController.register);
router.post("/chunk", chunkUpload.single("chunk"), uploadController.chunk);
router.post("/blob-status", uploadController.blobStatus);

export default router;
