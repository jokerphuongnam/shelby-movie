import Redis from "ioredis";

// Each chunk is 1MB. Chunks are cached independently so a range request
// for bytes 2MB-3MB only fetches chunk index 2, not the entire blob.
const CHUNK_SIZE = 1024 * 1024; // 1MB
const CHUNK_TTL = parseInt(process.env.REDIS_CHUNK_TTL_SECONDS ?? "3600", 10);
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS ?? "21600", 10);

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function chunkKey(blobId: string, chunkIndex: number) {
  return `shelby:chunk:${blobId}:${chunkIndex}`;
}

function sessionKey(sessionToken: string) {
  return `session:${sessionToken}`;
}

export async function getChunk(blobId: string, chunkIndex: number): Promise<Buffer | null> {
  return redis.getBuffer(chunkKey(blobId, chunkIndex));
}

export async function setChunk(blobId: string, chunkIndex: number, data: Buffer): Promise<void> {
  await redis.setex(chunkKey(blobId, chunkIndex), CHUNK_TTL, data);
}

export function chunkIndexForByte(byteOffset: number): number {
  return Math.floor(byteOffset / CHUNK_SIZE);
}

export function chunkByteRange(chunkIndex: number): { start: number; end: number } {
  return {
    start: chunkIndex * CHUNK_SIZE,
    end: (chunkIndex + 1) * CHUNK_SIZE - 1,
  };
}

interface SessionData {
  blobId: string;
  previewDuration: number | null;
  totalDuration: number | null;
}

export async function getSession(sessionToken: string): Promise<SessionData | null> {
  const raw = await redis.get(sessionKey(sessionToken));
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function setSession(
  sessionToken: string,
  blobId: string,
  previewDuration?: number,
  totalDuration?: number
): Promise<void> {
  const data: SessionData = {
    blobId,
    previewDuration: previewDuration ?? null,
    totalDuration: totalDuration ?? null,
  };
  await redis.setex(sessionKey(sessionToken), SESSION_TTL, JSON.stringify(data));
}
