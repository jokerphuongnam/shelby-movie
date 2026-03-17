import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

const HLS_DIR = process.env.HLS_TMP_DIR ?? "/tmp/hls";

export function getHlsDir(blobId: string): string {
  return path.join(HLS_DIR, blobId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

export function hlsManifestPath(blobId: string): string {
  return path.join(getHlsDir(blobId), "master.m3u8");
}

export function hlsSegmentPath(blobId: string, segment: string): string | null {
  const dir = getHlsDir(blobId);
  const segPath = path.join(dir, segment);
  // prevent path traversal
  if (!segPath.startsWith(dir)) return null;
  return segPath;
}

export async function transcodeToHls(blobId: string, sourceUrl: string): Promise<void> {
  const outDir = getHlsDir(blobId);
  fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(sourceUrl)
      .outputOptions([
        "-c:v h264",
        "-c:a aac",
        "-hls_time 10",
        "-hls_list_size 0",
        "-hls_segment_filename",
        path.join(outDir, "%03d.ts"),
        "-f hls",
      ])
      .output(path.join(outDir, "master.m3u8"))
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export async function getOrTranscodeHls(blobId: string, sourceUrl: string): Promise<string> {
  const manifest = hlsManifestPath(blobId);
  if (!fs.existsSync(manifest)) {
    await transcodeToHls(blobId, sourceUrl);
  }
  return getHlsDir(blobId);
}
