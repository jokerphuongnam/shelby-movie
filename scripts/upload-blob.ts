/**
 * Manual Blob Upload Script
 *
 * Workflow:
 *   1. generateCommitments — compute Clay erasure coding commitments from file
 *   2. registerBlob        — publish commitments on Aptos (Move contract call)
 *   3. putBlob             — upload encoded shards to Shelby RPC storage nodes
 *
 * Clay Erasure Coding:
 *   Clay codes are a class of MSR (Minimum Storage Regenerating) codes.
 *   They allow reconstruction of any original data symbol by contacting only
 *   d out of n storage nodes — minimising repair bandwidth vs. Reed-Solomon.
 *   The SDK handles encoding; this script passes the raw file buffer to it.
 *
 * Usage:
 *   SHELBY_API_KEY=xxx SHELBY_RPC_URL=yyy ts-node scripts/upload-blob.ts <file>
 */

import fs from "fs";
import path from "path";

// TODO: Replace with real Shelby Protocol SDK imports
// import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
// import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: ts-node upload-blob.ts <path-to-video>");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);

  console.log(`File: ${fileName} (${(fileBuffer.length / 1e6).toFixed(2)} MB)`);

  // ── Step 1: Generate Clay erasure coding commitments ──────────────────────
  // The SDK shards the file into k+m pieces and returns a commitment hash
  // that will be anchored on Aptos to prove data availability.
  console.log("\n[1/3] Calculating Clay erasure coding commitments…");
  // const commitments = await shelbyClient.generateCommitments(fileBuffer);
  // console.log("  Root hash:", commitments.rootHash);
  console.log("  TODO: shelbyClient.generateCommitments(fileBuffer)");

  // ── Step 2: Register blob on Aptos ────────────────────────────────────────
  // This Move call anchors the commitment hash on-chain and assigns a blobId.
  // The caller pays gas; the blobId is used for all subsequent reads/streams.
  // Micropayment note: each registered blob consumes a small APT deposit that
  // is released when the blob is deregistered (proof of storage incentive).
  console.log("\n[2/3] Registering blob on Aptos…");
  // const { blobId, txHash } = await shelbyClient.registerBlob(commitments);
  // console.log("  blobId:", blobId, "  txHash:", txHash);
  console.log("  TODO: shelbyClient.registerBlob(commitments)");

  // ── Step 3: Upload shards to Shelby storage nodes ─────────────────────────
  // The SDK distributes erasure-coded shards across k+m Storage Providers.
  // Shelby verifies each shard against the on-chain commitment before
  // accepting it, preventing malicious/incorrect data injection.
  console.log("\n[3/3] Uploading shards to Shelby storage network…");
  // await shelbyClient.putBlob(blobId, fileBuffer);
  console.log("  TODO: shelbyClient.putBlob(blobId, fileBuffer)");

  console.log("\nUpload complete. Add blobId to Movie document in MongoDB.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
