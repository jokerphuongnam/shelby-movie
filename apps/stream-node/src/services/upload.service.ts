import fs from "fs";
import path from "path";
import crypto from "crypto";
import { shelbyClient } from "../shelby/shelby.client";

const TMP_DIR = path.join(process.cwd(), ".tmp-uploads");

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Shelby Protocol clay erasure coding scheme enum values (from SDK constants)
const ENCODING_CLAY_16_10 = 0; // ClayCode_16Total_10Data_13Helper (default)
// SDK: chunkSizeBytes(1 MiB) × erasure_k(10) = 10 MiB per chunkset
const DEFAULT_CHUNKSET_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Generate Clay erasure coding commitments from a video buffer.
 *
 * Returns all fields the frontend needs to build the register_blob Move transaction:
 *   register_blob(blobName, expirationMicros, merkleRoot, numChunksets, blobSize, 0, encoding)
 *
 * TODO: replace SHA-256 placeholder with real Clay commitment once SDK supports
 *       server-side commitment generation without a signer account.
 */
export async function generateCommitments(videoBuffer: Buffer): Promise<{
  commitmentHash: string;
  blobName: string;
  blobMerkleRootHex: string;
  expirationMicros: string;
  numChunksets: number;
  blobSize: number;
  encoding: number;
  uploadSessionId: string;
}> {
  // SHA-256 of raw bytes — placeholder for the real Clay merkle root
  const commitmentHash = crypto.createHash("sha256").update(videoBuffer).digest("hex");
  const uploadSessionId = crypto.randomBytes(16).toString("hex");

  // Blob name matches the Shelby SDK convention: "movies/<hash-prefix>"
  const blobName = `movies/${commitmentHash}`;

  // Expiration: 1 hour from now in microseconds (matches SDK example).
  // Storage deposit = blobSize × rate × duration — keep short for affordable fees.
  // Use BigInt arithmetic to avoid JS float precision loss on u64 values.
  const expirationMicros = (BigInt(Date.now()) * 1000n + 3_600_000_000n).toString();

  const blobSize = videoBuffer.length;
  const numChunksets = Math.max(1, Math.ceil(blobSize / DEFAULT_CHUNKSET_SIZE_BYTES));

  const sessionPath = path.join(TMP_DIR, uploadSessionId);
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(
    path.join(sessionPath, "meta.json"),
    JSON.stringify({ commitmentHash, blobName, blobSize })
  );

  return {
    commitmentHash,
    blobName,
    blobMerkleRootHex: commitmentHash,
    expirationMicros,
    numChunksets,
    blobSize,
    encoding: ENCODING_CLAY_16_10,
    uploadSessionId,
  };
}

/**
 * Confirm blob registration after the Aptos tx is finalised.
 *
 * blobId is stored as "{walletAddress}/{blobName}" so the stream-node can call
 * shelbyClient.download({ account: walletAddress, blobName }) for streaming.
 *
 * TODO: parse the BlobRegistered event from the Aptos tx receipt to verify
 * the blobName matches what was registered on-chain.
 */
export async function confirmRegistration(
  txHash: string,
  uploadSessionId: string,
  walletAddress: string
): Promise<{ blobId: string }> {
  const sessionPath = path.join(TMP_DIR, uploadSessionId);
  const meta = JSON.parse(fs.readFileSync(path.join(sessionPath, "meta.json"), "utf8"));

  // Composite blobId: "{walletAddress}/{blobName}"
  // Stream-node parses this in shelby.client.ts when downloading
  const blobId = `${walletAddress}/${meta.blobName}`;

  fs.writeFileSync(
    path.join(sessionPath, "meta.json"),
    JSON.stringify({ ...meta, blobId, txHash })
  );

  return { blobId };
}

/**
 * Accept a 5MB chunk and persist it to the tmp session directory.
 * When all chunks are received, reassemble and call shelbyClient.putBlob().
 */
export async function receiveChunk(
  uploadSessionId: string,
  blobId: string,
  chunkIndex: number,
  totalChunks: number,
  chunkBuffer: Buffer
): Promise<{ complete: boolean }> {
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

  // TODO: replace with shelbyClient.upload(blobId, fullBuffer) once SDK upload API is finalized
  await shelbyClient.download(blobId); // placeholder — must replace with putBlob

  fs.rmSync(sessionPath, { recursive: true, force: true });

  return { complete: true };
}
