/**
 * Shelby Protocol Node Client
 *
 * blobId format: "{creatorAddress}/{blobName}" — e.g.
 *   "0x85fdb9a.../movies/abc123-1711123456"
 *
 * The Shelby SDK is ESM-only; we bridge it into CJS with a lazy dynamic import()
 * cached after the first call.
 *
 * IMPORTANT: The Shelby RPC node requires an `Origin` header on every request.
 * Node.js fetch does not set Origin automatically (unlike browsers), so we patch
 * globalThis.fetch at module load time to inject it for all Shelby RPC calls.
 */

// ── Origin header patch ──────────────────────────────────────────────────────
// Must run before the SDK client is ever initialized.
const SHELBY_NETWORK = process.env.SHELBY_NETWORK ?? "testnet";
const SHELBY_RPC_BASE = `https://api.${SHELBY_NETWORK}.shelby.xyz/shelby`;

// Ordered candidates — first one that the RPC accepts will be used for all subsequent requests.
const ORIGIN_CANDIDATES = [
  process.env.SHELBY_ORIGIN,
  "http://localhost:4545",
  "http://localhost:3000",
  "http://localhost",
  "http://127.0.0.1:4545",
  "http://127.0.0.1",
].filter(Boolean) as string[];

// Resolved at runtime; starts null so the first Shelby request auto-detects.
let _acceptedOrigin: string | null = null;

function flattenHeaders(h: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (h instanceof Headers) {
    h.forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else {
    Object.assign(out, h);
  }
  return out;
}

if (typeof globalThis.fetch === "function") {
  const _origFetch = globalThis.fetch.bind(globalThis);

  (globalThis as any).fetch = async function (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (!url.startsWith(SHELBY_RPC_BASE)) {
      return _origFetch(input, init);
    }

    const baseHeaders = flattenHeaders(init?.headers ?? {});
    // Caller already set Origin — trust it.
    if (baseHeaders["origin"] || baseHeaders["Origin"]) {
      return _origFetch(input, init);
    }

    // Use previously resolved origin without retry overhead.
    if (_acceptedOrigin) {
      return _origFetch(input, { ...init, headers: { ...baseHeaders, Origin: _acceptedOrigin } });
    }

    // Auto-detect: try each candidate until RPC accepts one.
    for (let i = 0; i < ORIGIN_CANDIDATES.length; i++) {
      const candidate = ORIGIN_CANDIDATES[i];
      const response = await _origFetch(input, { ...init, headers: { ...baseHeaders, Origin: candidate } });

      if (response.status !== 401) {
        _acceptedOrigin = candidate;
        if (i > 0) console.log(`[shelby] Accepted Origin: ${candidate}`);
        return response;
      }

      const body = await response.clone().text().catch(() => "");
      // If the 401 is unrelated to Origin, return it immediately.
      if (!body.toLowerCase().includes("origin")) {
        console.warn(`[shelby] 401 (non-origin) with "${candidate}": ${body.slice(0, 120)}`);
        return response;
      }

      console.warn(`[shelby] Origin "${candidate}" rejected (${i + 1}/${ORIGIN_CANDIDATES.length}): ${body.slice(0, 120)}`);
    }

    // All candidates exhausted — return last response as-is.
    return _origFetch(input, { ...init, headers: { ...baseHeaders, Origin: ORIGIN_CANDIDATES[ORIGIN_CANDIDATES.length - 1] } });
  };
}
// ── End patch ────────────────────────────────────────────────────────────────

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
  if (slash === -1) throw new Error(`Invalid blobId: "${blobId}" — expected "{account}/{blobName}"`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any | null = null;

async function getClient() {
  if (_client) return _client;
  const { ShelbyNodeClient } = await import("@shelby-protocol/sdk/node");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client = new ShelbyNodeClient({ network: SHELBY_NETWORK, apiKey: process.env.SHELBY_API_KEY } as any);
  return _client;
}

class ShelbyClient {
  async putBlob(blobId: string, data: Buffer): Promise<void> {
    const { account, blobName } = parseBlobId(blobId);
    if (!account || !blobName) {
      throw new Error(`putBlob: invalid blobId "${blobId}" — account="${account}" blobName="${blobName}"`);
    }
    const client = await getClient();
    try {
      await client.rpc.putBlob({ account, blobName, blobData: data });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      console.warn(`[shelby] SDK error: "${msg.slice(0, 120)}" — retrying via direct`);
      await this.putBlobDirect(account, blobName, data);
    }
  }

  // Simple single-call upload for small blobs.
  // Tries PUT /v1/blobs/{account}/{blobName} — the symmetric counterpart to GET.
  private async putBlobSimple(
    account: string,
    blobName: string,
    data: Buffer,
    authHdr: Record<string, string>
  ): Promise<void> {
    const encodedName = blobName.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${SHELBY_RPC_BASE}/v1/blobs/${account}/${encodedName}`, {
      method: "PUT",
      headers: { ...authHdr, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[shelby-simple] ${res.status}: ${body.slice(0, 200)}`);
    }
    console.log(`[shelby-simple] OK: ${account}/${blobName} (${data.length} bytes)`);
  }

  private async putBlobDirect(account: string, blobName: string, data: Buffer): Promise<void> {
    if (!account || !blobName) {
      throw new Error(`[shelby-direct] FATAL: missing metadata — account="${account}" blobName="${blobName}"`);
    }
    if (!data.length) {
      throw new Error("[shelby-direct] FATAL: data buffer is empty");
    }

    const apiKey = process.env.SHELBY_API_KEY ?? "";
    const authHdr = { Authorization: `Bearer ${apiKey}`, Connection: "keep-alive" };
    const PART_SIZE = 5 * 1024 * 1024;

    // Small files: direct single-call upload ONLY — multipart is unreliable for small blobs.
    // Do not fall back to multipart if this fails; surface the error immediately.
    if (data.length < PART_SIZE) {
      await this.putBlobSimple(account, blobName, data, authHdr);
      return;
    }

    // ── 1. Split into parts ──────────────────────────────────────────────────
    const parts: Buffer[] = [];
    for (let offset = 0; offset < data.length; offset += PART_SIZE) {
      parts.push(data.subarray(offset, offset + PART_SIZE));
    }
    // Shelby RPC rejects complete when only 1 part was uploaded; split into 2 halves.
    // rawPartSize must equal parts[0].length so server computes expectedParts = 2.
    let rawPartSize = PART_SIZE;
    if (parts.length === 1) {
      const mid = Math.ceil(data.length / 2);
      parts.splice(0, 1, data.subarray(0, mid), data.subarray(mid));
      rawPartSize = parts[0].length;
    }

    // ── 2. Start ─────────────────────────────────────────────────────────────
    const startPayload = { rawAccount: account, rawBlobName: blobName, rawPartSize };
    console.log("[shelby-direct] start:", { ...startPayload, dataBytes: data.length, numParts: parts.length });

    const startRes = await fetch(`${SHELBY_RPC_BASE}/v1/multipart-uploads`, {
      method: "POST",
      headers: { ...authHdr, "Content-Type": "application/json" },
      body: JSON.stringify(startPayload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!startRes.ok) {
      const body = await startRes.text().catch(() => "");
      throw new Error(`[shelby-direct] start ${startRes.status}: ${body.slice(0, 200)}`);
    }
    const startJson = await startRes.json();
    const uploadId: string = startJson.uploadId ?? startJson.id ?? startJson.upload_id;
    if (!uploadId) {
      throw new Error(`[shelby-direct] start: no id in response ${JSON.stringify(startJson)}`);
    }

    // ── 3. Upload parts (0-based, matching SDK) ───────────────────────────────
    for (let i = 0; i < parts.length; i++) {
      console.log(`[shelby-direct] part ${i}/${parts.length - 1} (${parts[i].length} bytes)`);
      const partRes = await fetch(`${SHELBY_RPC_BASE}/v1/multipart-uploads/${uploadId}/parts/${i}`, {
        method: "PUT",
        headers: { ...authHdr, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(parts[i]),
        signal: AbortSignal.timeout(300_000),
      });
      if (!partRes.ok) {
        const body = await partRes.text().catch(() => "");
        throw new Error(`[shelby-direct] part ${i} ${partRes.status}: ${body.slice(0, 200)}`);
      }
    }

    // ── 4. Complete ───────────────────────────────────────────────────────────
    const indices = parts.map((_, i) => i);
    const completePayload = { parts: indices };
    console.log("[shelby-direct] complete payload:", JSON.stringify({
      uploadId, account, blobName, partsCount: parts.length, indices,
    }));
    const completeRes = await fetch(`${SHELBY_RPC_BASE}/v1/multipart-uploads/${uploadId}/complete`, {
      method: "POST",
      headers: { ...authHdr, "Content-Type": "application/json" },
      body: JSON.stringify(completePayload),
      signal: AbortSignal.timeout(300_000),
    });
    if (!completeRes.ok) {
      const completeBody = await completeRes.text().catch(() => "");
      console.error(`[shelby-direct] complete ${completeRes.status} body: ${completeBody}`);

      // 400 may mean the server assembled the blob asynchronously — probe before failing.
      if (completeRes.status === 400) {
        const exists = await this.probeExists(account, blobName, authHdr);
        if (exists) {
          console.log(`[shelby-direct] complete 400 but blob is available — treating as OK`);
          return;
        }
      }
      throw new Error(`[shelby-direct] complete ${completeRes.status}: ${completeBody.slice(0, 300)}`);
    }
    console.log(`[shelby-direct] putBlob OK: ${account}/${blobName} (${data.length} bytes, ${parts.length} parts)`);
  }

  private async probeExists(account: string, blobName: string, authHdr: Record<string, string>): Promise<boolean> {
    try {
      const encodedName = blobName.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`${SHELBY_RPC_BASE}/v1/blobs/${account}/${encodedName}`, {
        headers: { ...authHdr, Range: "bytes=0-0" },
      });
      return res.ok || res.status === 206;
    } catch {
      return false;
    }
  }

  async download(blobId: string): Promise<Buffer> {
    const { account, blobName } = parseBlobId(blobId);
    const client = await getClient();
    const blob = await client.download({ account, blobName });
    return readableStreamToBuffer(blob.readable as ReadableStream);
  }

  async downloadRange(blobId: string, range: RangeOptions): Promise<ShelbyDownloadResult> {
    const { account, blobName } = parseBlobId(blobId);
    const client = await getClient();
    const blob = await client.download({ account, blobName, range: { start: range.start, end: range.end } });
    const data = await readableStreamToBuffer(blob.readable as ReadableStream);
    return { data, totalSize: blob.contentLength as number };
  }
}

export const shelbyClient = new ShelbyClient();
