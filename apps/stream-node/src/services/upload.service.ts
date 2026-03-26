import fs from "fs";
import path from "path";
import crypto from "crypto";
import { shelbyClient } from "../shelby/shelby.client";

async function computeCommitments(data: Uint8Array) {
  const { generateCommitments, createDefaultErasureCodingProvider } = await import("@shelby-protocol/sdk/node");
  const provider = await createDefaultErasureCodingProvider();
  const commitments = await generateCommitments(provider, data);
  return { commitments, enumIndex: provider.config.enumIndex };
}

const TMP_DIR = path.join(process.cwd(), ".tmp-uploads");

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export async function initUploadSession(fileId: string): Promise<{
  uploadSessionId: string;
  blobName: string;
  expirationMicros: string;
}> {
  const uploadSessionId = crypto.randomBytes(16).toString("hex");
  const safeId = fileId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  const blobName = `movies/${safeId}-${Date.now()}`;
  const expirationMicros = (BigInt(Date.now()) * 1000n + 3_600_000_000n).toString();

  const sessionPath = path.join(TMP_DIR, uploadSessionId);
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(path.join(sessionPath, "meta.json"), JSON.stringify({ blobName }));

  return { uploadSessionId, blobName, expirationMicros };
}

/**
 * Confirm blob registration and upload assembled file to Shelby RPC.
 *
 * blobId is stored as "{walletAddress}/{blobName}" so the stream-node can call
 * shelbyClient.download({ account: walletAddress, blobName }) for streaming.
 */
export async function confirmRegistration(
  txHash: string,
  uploadSessionId: string,
  walletAddress: string
): Promise<{ blobId: string }> {
  const sessionPath = path.join(TMP_DIR, uploadSessionId);
  const meta = JSON.parse(fs.readFileSync(path.join(sessionPath, "meta.json"), "utf8"));

  const blobId = `${walletAddress}/${meta.blobName}`;
  const fullBuffer = fs.readFileSync(path.join(sessionPath, "assembled.bin"));

  const BACKOFF = [10_000, 20_000];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await shelbyClient.putBlob(blobId, fullBuffer);
      break;
    } catch (err: any) {
      console.error(`[shelby] putBlob attempt ${attempt}/3 failed:`, err?.message ?? err);
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, BACKOFF[attempt - 1]));
    }
    if (attempt === 3) throw new Error(`Shelby RPC upload failed after 3 attempts: ${(lastErr as any)?.message ?? lastErr}`);
  }

  fs.rmSync(sessionPath, { recursive: true, force: true });
  return { blobId };
}

export async function receiveChunk(
  uploadSessionId: string,
  chunkIndex: number,
  totalChunks: number,
  chunkBuffer: Buffer
): Promise<{
  complete: boolean;
  blobMerkleRootHex?: string;
  numChunksets?: number;
  blobSize?: number;
  encoding?: number;
}> {
  const sessionPath = path.join(TMP_DIR, uploadSessionId);
  fs.writeFileSync(path.join(sessionPath, `chunk-${chunkIndex}`), chunkBuffer);

  const receivedChunks = fs
    .readdirSync(sessionPath)
    .filter((f) => f.startsWith("chunk-")).length;

  if (receivedChunks < totalChunks) {
    return { complete: false };
  }

  const buffers: Buffer[] = [];
  for (let i = 0; i < totalChunks; i++) {
    buffers.push(fs.readFileSync(path.join(sessionPath, `chunk-${i}`)));
  }
  const fullBuffer = Buffer.concat(buffers);

  fs.writeFileSync(path.join(sessionPath, "assembled.bin"), fullBuffer);

  // Clean up individual chunk files now that we have the assembled binary
  for (let i = 0; i < totalChunks; i++) {
    fs.rmSync(path.join(sessionPath, `chunk-${i}`), { force: true });
  }

  console.log(`[upload] Computing commitments for ${(fullBuffer.length / 1024 / 1024).toFixed(1)} MiB…`);
  const { commitments, enumIndex } = await computeCommitments(new Uint8Array(fullBuffer));

  const blobMerkleRootHex = commitments.blob_merkle_root;
  const numChunksets = commitments.chunkset_commitments.length;
  const blobSize = commitments.raw_data_size;
  const encoding = enumIndex;

  console.log("[upload] Merkle root:", blobMerkleRootHex);
  console.log(`[upload] numChunksets=${numChunksets}, blobSize=${blobSize}, encoding=${encoding}`);

  return { complete: true, blobMerkleRootHex, numChunksets, blobSize, encoding };
}

/**
 * Probe whether a blob is accessible on the Shelby RPC node.
 * Used by the client to detect a "silent success" after a 502 timeout.
 */
export async function checkBlobExists(blobId: string): Promise<boolean> {
  try {
    await shelbyClient.downloadRange(blobId, { start: 0, end: 0 });
    return true;
  } catch {
    return false;
  }
}
