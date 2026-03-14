/**
 * Shelby Protocol Node Client
 *
 * Shelby uses Clay Erasure Coding to shard blobs across Storage Providers (SPs).
 * Each blob is encoded into k+m shards where:
 *   - k = minimum shards needed to reconstruct the original data
 *   - m = redundancy shards (tolerated failures)
 *
 * When we call download(), the SDK:
 *   1. Queries the Aptos smart contract for shard locations
 *   2. Fetches k-of-(k+m) shards in parallel from multiple SPs
 *   3. Decodes via Clay erasure matrix to reconstruct the original bytes
 *
 * Range requests map byte offsets to specific shards, avoiding full blob downloads.
 *
 * blobId format: "{creatorAddress}/{blobName}" — e.g.
 *   "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a/movie-123.mp4"
 *
 * The Shelby SDK is ESM-only; we bridge it into CJS with a lazy dynamic import()
 * that is cached after the first call.
 */

export interface RangeOptions {
  start: number;
  end: number;
}

export interface ShelbyDownloadResult {
  data: Buffer;
  totalSize: number;
}

function parseBlobId(blobId: string): { account: string; blobName: string } {
  const slash = blobId.indexOf("/");
  if (slash === -1) throw new Error(`Invalid blobId format: "${blobId}" — expected "{account}/{blobName}"`);
  return { account: blobId.slice(0, slash), blobName: blobId.slice(slash + 1) };
}

async function readableStreamToBuffer(readable: ReadableStream): Promise<Buffer> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Lazy-loaded SDK client — cached after first init.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any | null = null;

async function getClient() {
  if (_client) return _client;
  // Dynamic import bridges ESM-only SDK into CJS stream-node.
  const { ShelbyNodeClient } = await import("@shelby-protocol/sdk/node");
  const network = process.env.SHELBY_NETWORK ?? "shelbynet";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client = new ShelbyNodeClient({ network, apiKey: process.env.SHELBY_API_KEY } as any);
  return _client;
}

class ShelbyClient {
  /**
   * Download a full blob by ID.
   * The SDK reconstructs the blob from k erasure-coded shards fetched in parallel.
   */
  async download(blobId: string): Promise<Buffer> {
    const { account, blobName } = parseBlobId(blobId);
    const client = await getClient();
    const blob = await client.download({ account, blobName });
    return readableStreamToBuffer(blob.readable as ReadableStream);
  }

  /**
   * Fetch a specific byte range from a blob.
   * Shelby's range API maps byte offsets to Clay shards so only the
   * required subset of SPs are contacted, minimising micropayment cost.
   */
  async downloadRange(blobId: string, range: RangeOptions): Promise<ShelbyDownloadResult> {
    const { account, blobName } = parseBlobId(blobId);
    const client = await getClient();
    const blob = await client.download({ account, blobName, range: { start: range.start, end: range.end } });
    const data = await readableStreamToBuffer(blob.readable as ReadableStream);
    return { data, totalSize: blob.contentLength as number };
  }
}

export const shelbyClient = new ShelbyClient();
