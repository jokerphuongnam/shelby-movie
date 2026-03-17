import { Router, Request, Response } from "express";
import { stream } from "../controllers/stream.controller";
import fs from "fs";
import path from "path";
import { getOrTranscodeHls, hlsManifestPath, hlsSegmentPath } from "../services/hls.service";

const router = Router();

router.get("/:blobId", stream);

router.get("/hls/:blobId/master.m3u8", async (req: Request, res: Response) => {
  const { blobId } = req.params;
  const sourceUrl = req.query.src as string | undefined;

  if (!sourceUrl) {
    const existing = hlsManifestPath(blobId);
    if (!fs.existsSync(existing)) {
      res.status(400).json({ error: "src query param required for first-time transcode" });
      return;
    }
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.sendFile(existing);
    return;
  }

  try {
    await getOrTranscodeHls(blobId, sourceUrl);
    const manifest = hlsManifestPath(blobId);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.sendFile(manifest);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Transcode failed" });
  }
});

router.get("/hls/:blobId/:segment", (req: Request, res: Response) => {
  const { blobId, segment } = req.params;
  const segPath = hlsSegmentPath(blobId, segment);
  if (!segPath || !fs.existsSync(segPath)) {
    res.status(404).json({ error: "Segment not found" });
    return;
  }
  const ct = segment.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/MP2T";
  res.setHeader("Content-Type", ct);
  res.sendFile(segPath);
});

export default router;
