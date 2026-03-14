import { Request, Response } from "express";
import { getSession } from "../services/cache.service";
import { streamRange, resolveBlobSize } from "../services/stream.service";

export async function stream(req: Request, res: Response) {
  // Accept token via header (API clients) or query string (browser <video> tag)
  const sessionToken =
    (req.headers["x-session-token"] as string) ?? (req.query.token as string);

  if (!sessionToken) {
    return res.status(401).json({ error: "x-session-token or ?token required" });
  }

  const session = await getSession(sessionToken);
  if (!session) {
    return res.status(403).json({ error: "Invalid or expired session token" });
  }

  const { blobId, previewDuration, totalDuration } = session;

  // Resolve total blob size (cached after first access)
  let totalSize: number;
  try {
    totalSize = await resolveBlobSize(blobId);
  } catch {
    return res.status(502).json({ error: "Failed to fetch blob metadata from Shelby" });
  }

  // Byte offset beyond which preview sessions are blocked
  const previewBytes =
    previewDuration && totalDuration && totalDuration > 0
      ? Math.floor(totalSize * previewDuration / totalDuration)
      : null;

  // Parse HTTP Range header (e.g. "bytes=0-1048575")
  const rangeHeader = req.headers.range;

  if (!rangeHeader) {
    if (previewBytes !== null) {
      // Cap non-range preview requests at the preview byte limit
      const { stream: s, contentLength } = await streamRange(blobId, 0, previewBytes - 1, totalSize);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", contentLength);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-Preview-Limit", String(previewBytes));
      return s.pipe(res);
    }
    const { stream: s, contentLength } = await streamRange(blobId, 0, totalSize - 1, totalSize);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", contentLength);
    res.setHeader("Accept-Ranges", "bytes");
    return s.pipe(res);
  }

  const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : totalSize - 1;

  // Enforce preview byte limit — 402 signals to the client that a paywall is required
  if (previewBytes !== null && start >= previewBytes) {
    return res.status(402).json({ error: "preview_ended" });
  }

  if (start >= totalSize || end >= totalSize || start > end) {
    res.setHeader("Content-Range", `bytes */${totalSize}`);
    return res.status(416).json({ error: "Range Not Satisfiable" });
  }

  try {
    const { stream: s, contentLength, contentRange } = await streamRange(blobId, start, end, totalSize);

    res.status(206);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Range", contentRange);
    res.setHeader("Accept-Ranges", "bytes");

    s.pipe(res);
  } catch (err) {
    console.error("Stream error:", err);
    res.status(502).json({ error: "Failed to stream from Shelby" });
  }
}
