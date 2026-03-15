import { Router } from "express";
import multer from "multer";
import * as uploadController from "../controllers/upload.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

const router = Router();

router.post("/commitments", upload.single("video"), uploadController.commitments);
router.post("/register", uploadController.register);
router.post("/chunk", upload.single("chunk"), uploadController.chunk);

export default router;
