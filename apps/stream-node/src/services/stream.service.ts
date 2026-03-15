import { Readable } from "stream";
import { shelbyClient } from "../shelby/shelby.client";
import {
  getChunk,
  setChunk,
  chunkIndexForByte,
  chunkByteRange,
} from "./cache.service";

function isPublicUrl(blobId: string) {
  return blobId.startsWith("https://") || blobId.startsWith("http://");
}

async function fetchPublicRange(url: string, start: number, end: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} fetching public URL`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolvePublicSize(url: string): Promise<number> {
  const head = await fetch(url, { method: "HEAD" });
  const len = parseInt(head.headers.get("content-length") ?? "0", 10);
  if (len > 0) return len;
  const rangeRes = await fetch(url, { headers: { Range: "bytes=0-0" } });
  const cr = rangeRes.headers.get("content-range");
  if (cr) {
    const total = parseInt(cr.split("/")[1], 10);
    if (!isNaN(total) && total > 0) return total;
  }
  throw new Error("Cannot determine size of public URL");
}

export interface StreamResult {
  stream: Readable;
  contentLength: number;
  contentRange: string;
  totalSize: number;
}

/**
 * Stream a byte range of a blob to the HTTP response.
 *
 * Strategy:
 *   1. Determine which 1MB chunk(s) cover the requested range
 *   2. For each chunk: check Redis → if miss, fetch from Shelby RPC and cache
 *   3. Slice the relevant bytes from the assembled chunks and pipe to response
 *
 * This approach means popular video segments (e.g. the first 5 minutes of a film)
 * are served entirely from Redis after the first viewer watches them, reducing
 * Shelby SP micropayment costs and latency for subsequent viewers.
 */
export async function streamRange(
  blobId: string,
  rangeStart: number,
  rangeEnd: number,
  totalSize: number
): Promise<StreamResult> {
  // Alpha mode: blobId is a public HTTP URL — bypass Shelby entirely
  if (isPublicUrl(blobId)) {
    const data = await fetchPublicRange(blobId, rangeStart, rangeEnd);
    return {
      stream: Readable.from(data),
      contentLength: data.length,
      contentRange: `bytes ${rangeStart}-${rangeEnd}/${totalSize}`,
      totalSize,
    };
  }

  const startChunk = chunkIndexForByte(rangeStart);
  const endChunk = chunkIndexForByte(rangeEnd);

  const buffers: Buffer[] = [];

  for (let i = startChunk; i <= endChunk; i++) {
    let chunk = await getChunk(blobId, i);

    if (!chunk) {
      const { start, end } = chunkByteRange(i);
      // Clamp to actual total size to avoid overshooting the blob boundary
      const clampedEnd = Math.min(end, totalSize - 1);
      const result = await shelbyClient.downloadRange(blobId, {
        start,
        end: clampedEnd,
      });
      chunk = result.data;
      await setChunk(blobId, i, chunk);
    }

    buffers.push(chunk);
  }

  const assembled = Buffer.concat(buffers);

  // Slice to the exact requested byte range from the assembled chunk buffers
  const chunkStartByte = chunkIndexForByte(rangeStart) * 1024 * 1024;
  const sliceStart = rangeStart - chunkStartByte;
  const sliceEnd = sliceStart + (rangeEnd - rangeStart + 1);
  const responseSlice = assembled.slice(sliceStart, sliceEnd);

  const readable = Readable.from(responseSlice);

  return {
    stream: readable,
    contentLength: responseSlice.length,
    contentRange: `bytes ${rangeStart}-${rangeEnd}/${totalSize}`,
    totalSize,
  };
}

/**
 * Resolve total blob size.
 * Attempts to use a cached first-chunk download to learn the total size,
 * falling back to a full metadata query if the SDK supports it.
 */
export async function resolveBlobSize(blobId: string): Promise<number> {
  // Alpha mode: resolve size via HTTP HEAD/Range on the public URL
  if (isPublicUrl(blobId)) {
    return resolvePublicSize(blobId);
  }
  // TODO: Use shelbyClient.stat(blobId) once SDK supports metadata queries
  // For now, download full blob to determine size (only on first access)
  const full = await shelbyClient.download(blobId);
  await setChunk(blobId, 0, full.slice(0, 1024 * 1024));
  return full.length;
}
