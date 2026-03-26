"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network, Hex } from "@aptos-labs/ts-sdk";
import type { MovieDto } from "@shelby-movie/shared-types";
import { getRandomAlphaThumbnail } from "@/lib/alpha-data";
import { Upload, CheckCircle, Film, X, ImageIcon, Trash2, Clock } from "lucide-react";
import { TransactionAudit } from "@/components/shared/TransactionAudit";

const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_THUMBNAIL_MB = 0;
const MAX_VIDEO_MB = 0;
const PRICE_PER_MINUTE_APT = parseFloat(process.env.NEXT_PUBLIC_APT_PRICE_MULTIPLIER ?? "0.5");
const APT_TO_OCTAS = 1e8;
const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

const UPLOAD_STAGES_ONCHAIN = ["Uploading…", "Register on Aptos", "Put to Shelby RPC"] as const;
const UPLOAD_STAGES_ALPHA = ["Encoding metadata…", "Registering on Shelby Alpha Node…", "Confirmed on Aptos Testnet…"] as const;
const UPLOAD_STAGES = IS_ALPHA ? UPLOAD_STAGES_ALPHA : UPLOAD_STAGES_ONCHAIN;
type UploadStage = string | null;

const CATEGORIES = [
  "Action", "Romance", "Animation", "Comedy", "Drama",
  "Horror", "Sci-Fi", "Documentary", "Thriller",
];

interface EpisodeInput {
  episodeNumber: number;
  title: string;
  duration: number;
}

interface FormValues {
  type: "movie" | "series";
  accessType: "free" | "paid";
  title: string;
  description: string;
  priceApt: string;
  durationSeconds: number;
  previewDuration: number;
  isFeatured: boolean;
  episodes: EpisodeInput[];
}

// All Aptos queries (balance, waitForTransaction, view functions) use the standard
// Aptos Testnet node. The Shelby RPC proxy does not reliably serve these endpoints.
const aptosTestnet = new Aptos(new AptosConfig({ network: Network.TESTNET }));

// ShelbyUSD — FA metadata address + classic coin type (from @shelby-protocol/sdk constants)
const SHELBY_SUSD_FA = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";
const SHELBY_SUSD_COIN_TYPE = "0x33009e852be7f93762dd0bf303383c2cb2c5cab7a30d8238ca5f9f177ae75124::shelby_usd::ShelbyUSD";
const SUSD_DECIMALS = 6;
// Estimated ShelbyUSD storage cost per MB (+ 5% buffer). Configurable via env.
const SUSD_PER_MB = parseFloat(process.env.NEXT_PUBLIC_SHELBY_STORAGE_COST_PER_MB ?? "0.0005");

/**
 * Fetch ShelbyUSD balance for an address.
 * Always uses the standard Aptos Testnet node — the Shelby RPC proxy does not
 * reliably serve view function calls.
 * Tries FA primary store first, falls back to classic CoinStore.
 */
async function fetchSUsdBalance(addr: string): Promise<number> {
  // 1. Try FA primary_fungible_store::balance (standard for newer tokens)
  try {
    const result = await aptosTestnet.view({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [addr, SHELBY_SUSD_FA],
      },
    });
    const raw = Number(result[0]);
    if (raw > 0) return raw / 10 ** SUSD_DECIMALS;
  } catch {
    // FA store not found — try coin store next
  }

  // 2. Fallback: classic CoinStore resource
  try {
    const resources = await aptosTestnet.getAccountResources({ accountAddress: addr });
    console.log("Found Assets:", resources.map((r) => r.type));
    const coinStore = resources.find((r) => r.type === `0x1::coin::CoinStore<${SHELBY_SUSD_COIN_TYPE}>`);
    if (coinStore) {
      const raw = Number((coinStore.data as any).coin?.value ?? 0);
      return raw / 10 ** SUSD_DECIMALS;
    }
  } catch {
    // ignore
  }

  // 3. Last resort: log all resources so we can see what Petra is using
  try {
    const resources = await aptosTestnet.getAccountResources({ accountAddress: addr });
    const shelbyResources = resources.filter((r) =>
      r.type.toLowerCase().includes("shelby") || r.type.includes(SHELBY_SUSD_FA.slice(0, 10))
    );
    if (shelbyResources.length > 0) {
      console.log("Found Assets:", shelbyResources);
    } else {
      console.log("Found Assets: no ShelbyUSD resources found for", addr);
    }
  } catch {
    // ignore
  }

  return 0;
}

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function extractVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(video.duration)); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}

function captureVideoFrame(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration > 0 ? video.duration * 0.05 : 1);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            resolve(blob ? new File([blob], "thumbnail.jpg", { type: "image/jpeg" }) : null);
          },
          "image/jpeg",
          0.85,
        );
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}

// Retry wrapper for Petra wallet calls that can fail transiently while the
// extension service worker is initialising ("Receiving end does not exist").
async function withWalletRetry<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 500): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const isExtensionRace = msg.includes("Receiving end does not exist")
        || msg.includes("Could not establish connection")
        || msg.includes("Extension context invalidated");
      if (isExtensionRace && attempt < maxAttempts) {
        console.warn(`[wallet] transient extension error (attempt ${attempt}), retrying in ${delayMs}ms…`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function waitWithRetry(hash: string, maxAttempts = 3, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Use standard Aptos Testnet node — the Shelby RPC node does not reliably
      // serve the Aptos REST /transactions/by_hash endpoint.
      await aptosTestnet.waitForTransaction({ transactionHash: hash });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}


// After a 502 on the final chunk (server likely finished assembling in background),
// wait briefly then probe whether Shelby already has the blob.
async function probeBlobExists(blobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${STREAM_URL}/upload/blob-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const { exists } = await res.json();
    return Boolean(exists);
  } catch {
    return false;
  }
}

// Files >= 50 MB get extended timeouts and the "assembling" UI banner.
// Small files should finalize in seconds — use fast-track probing with no delay.
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;

const STAGE_LABEL_TO_INDEX: Record<string, number> = {
  "Generating upload session…": 0,
  "Uploading…": 0,
  "Register on Aptos": 1,
  "Finalizing on Shelby Network…": 1,
  "Put to Shelby RPC": 2,
};

interface ChunkCommitments {
  blobMerkleRootHex: string;
  numChunksets: number;
  blobSize: number;
  encoding: number;
}

// Uploads all chunks to the stream-node. On the last chunk the server assembles
// the file and computes real Clay commitments — returns those for the Aptos tx.
async function uploadChunks(
  videoFile: File,
  uploadSessionId: string,
  onProgress: (pct: number) => void,
  onStage?: (label: string) => void,
  onAssembling?: (msg: string | null) => void
): Promise<ChunkCommitments> {
  onStage?.("Uploading…");
  const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
  const isLargeFile = videoFile.size >= LARGE_FILE_THRESHOLD;
  let commitmentData: ChunkCommitments | null = null;

  for (let i = 0; i < totalChunks; i++) {
    const isLastChunk = i === totalChunks - 1;
    // Last chunk triggers WASM commitment computation server-side — allow generous time.
    const timeoutMs = isLastChunk ? (isLargeFile ? 600_000 : 300_000) : 30_000;
    const maxAttempts = isLastChunk ? 3 : 1;
    const retryBackoff = isLargeFile ? [10_000, 20_000] : [2_000, 5_000];

    const start = i * CHUNK_SIZE;
    const chunk = videoFile.slice(start, Math.min(start + CHUNK_SIZE, videoFile.size));

    let lastChunkErr: string | null = null;
    let succeeded = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const chunkForm = new FormData();
        chunkForm.append("chunk", chunk);
        chunkForm.append("chunkIndex", String(i));
        chunkForm.append("totalChunks", String(totalChunks));
        chunkForm.append("uploadSessionId", uploadSessionId);

        if (isLastChunk) {
          onAssembling?.("Computing commitments… Please wait.");
        }

        const chunkRes = await fetch(`${STREAM_URL}/upload/chunk`, {
          method: "POST",
          body: chunkForm,
          signal: controller.signal,
        });

        if (!chunkRes.ok) {
          const errText = await chunkRes.text().catch(() => chunkRes.statusText);
          console.error(`[upload] Chunk ${i + 1}/${totalChunks} attempt ${attempt} — HTTP ${chunkRes.status}:`, errText);
          lastChunkErr = `HTTP ${chunkRes.status}: ${errText}`;

          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, retryBackoff[attempt - 1]));
            continue;
          }
          throw new Error(`Chunk ${i + 1}/${totalChunks} failed — ${lastChunkErr}`);
        }

        const data = await chunkRes.json();
        if (isLastChunk && data.complete && data.blobMerkleRootHex) {
          commitmentData = {
            blobMerkleRootHex: data.blobMerkleRootHex,
            numChunksets: data.numChunksets,
            blobSize: data.blobSize,
            encoding: data.encoding,
          };
          onAssembling?.(null);
        }

        succeeded = true;
        break;
      } catch (err: any) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
          lastChunkErr = `timeout after ${timeoutMs / 1000}s`;
          console.error(`[upload] Chunk ${i + 1}/${totalChunks} attempt ${attempt} timed out`);
        } else if (err.message?.startsWith("Chunk ")) {
          throw err;
        } else {
          lastChunkErr = err.message;
          console.error(`[upload] Chunk ${i + 1}/${totalChunks} attempt ${attempt} error:`, err.message);
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, retryBackoff[attempt - 1]));
          continue;
        }
        if (!succeeded) throw new Error(`Chunk ${i + 1}/${totalChunks} failed — ${lastChunkErr}`);
      } finally {
        clearTimeout(timer);
      }
    }

    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  if (!commitmentData) throw new Error("Upload completed but server did not return commitment data");
  return commitmentData;
}

async function uploadBlob(
  videoFile: File,
  walletAddress: string,
  signAndSubmitTransaction: (tx: any) => Promise<{ hash: string }>,
  onProgress: (pct: number) => void,
  onStage?: (label: string) => void,
  onAssembling?: (msg: string | null) => void,
  onTxHash?: (hash: string) => void
): Promise<string> {
  // 1. Init upload session — get blobName for the Aptos tx
  onStage?.("Generating upload session…");
  const fileId = `${videoFile.name.replace(/[^a-zA-Z0-9]/g, "")}-${videoFile.size}-${videoFile.lastModified}`;

  let initRes: Response;
  try {
    initRes = await fetch(`${STREAM_URL}/upload/commitments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
  } catch (err: any) {
    throw new Error(`Failed to init upload session — ${err?.message ?? err}`);
  }
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => "");
    throw new Error(`Failed to init upload session — HTTP ${initRes.status}${body ? `: ${body}` : ""}`);
  }
  const { uploadSessionId, blobName, expirationMicros } = await initRes.json();

  // 2. Upload all chunks — last chunk triggers server-side commitment computation
  const { blobMerkleRootHex, numChunksets, blobSize, encoding } = await uploadChunks(
    videoFile, uploadSessionId, onProgress, onStage, onAssembling
  );

  console.log("[upload] Local Merkle Root:", blobMerkleRootHex);

  // 3. Sign Aptos register_blob tx with the real merkle root
  onStage?.("Register on Aptos");
  const merkleRootBytes = Hex.fromHexInput(blobMerkleRootHex).toUint8Array();

  let registerTx: { hash: string };
  try {
    registerTx = await withWalletRetry(() => signAndSubmitTransaction({
      data: {
        function: `${process.env.NEXT_PUBLIC_SHELBY_CONTRACT}::blob_metadata::register_blob`,
        typeArguments: [],
        functionArguments: [
          blobName,
          expirationMicros,
          merkleRootBytes,
          Math.trunc(numChunksets),
          Math.trunc(blobSize),
          0,
          Math.trunc(encoding),
        ],
      },
      options: { maxGasAmount: 50000 },
    }));
  } catch (err: any) {
    if (err?.message?.includes("blob") && err.message.toLowerCase().includes("already exists")) {
      throw new Error("Upload conflict: a blob with this name already exists on Shelby and has not expired yet. Please wait ~1 hour and try again, or re-select the file.");
    }
    throw err;
  }

  onTxHash?.(registerTx.hash);
  onStage?.("Finalizing on Shelby Network…");
  await waitWithRetry(registerTx.hash);

  // 4. Confirm registration — triggers putBlob on the stream-node
  onStage?.("Put to Shelby RPC");
  const isLargeFile = videoFile.size >= LARGE_FILE_THRESHOLD;
  const registerTimeoutMs = isLargeFile ? 600_000 : 300_000;

  const blobIdRes = await fetch(`${STREAM_URL}/upload/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: registerTx.hash, uploadSessionId, walletAddress }),
    signal: AbortSignal.timeout(registerTimeoutMs),
  });

  if (!blobIdRes.ok) {
    const errText = await blobIdRes.text().catch(() => blobIdRes.statusText);
    // On timeout/502, probe Shelby — putBlob may have succeeded silently
    if (blobIdRes.status === 502 || blobIdRes.status === 504) {
      onAssembling?.("Verifying upload… Please wait.");
      await new Promise((r) => setTimeout(r, isLargeFile ? 30_000 : 5_000));
      const blobId = `${walletAddress}/${blobName}`;
      const exists = await probeBlobExists(blobId);
      onAssembling?.(null);
      if (exists) {
        console.log("[upload] Blob confirmed live after register timeout.");
        return blobId;
      }
    }
    throw new Error(`Failed to confirm blob registration — HTTP ${blobIdRes.status}: ${errText}`);
  }

  const { blobId } = await blobIdRes.json();
  return blobId;
}

// ── UploadProgressOverlay ─────────────────────────────────────────────────────

interface UploadOverlayProps {
  stageIndex: number;
  chunkProgress: number;
  assemblingMsg: string | null;
  txHash: string | null;
  done: boolean;
  error: string | null;
  movieTitle: string;
  movieId: string | null;
  onRetry: () => void;
  onNavigate: (path: string) => void;
}

const OVERLAY_STAGES = [
  { label: "Fingerprint", desc: "Uploading & computing commitments" },
  { label: "Register",    desc: "Signing on Aptos blockchain" },
  { label: "Upload",      desc: "Sending to Shelby Network" },
  { label: "Finalize",    desc: "Assembling & verifying" },
] as const;

function UploadProgressOverlay({
  stageIndex, chunkProgress, assemblingMsg, txHash, done, error, movieTitle, movieId, onRetry, onNavigate,
}: UploadOverlayProps) {
  const [countdown, setCountdown] = useState(3);

  const displayStage = assemblingMsg && stageIndex >= 2 ? 3 : Math.min(stageIndex, 2);

  useEffect(() => {
    if (!done) return;
    let alive = true;
    (async () => {
      const { default: fire } = await import("canvas-confetti");
      if (!alive) return;
      fire({ particleCount: 160, spread: 70, origin: { y: 0.6 } });
      setTimeout(() => alive && fire({ particleCount: 90, angle: 60,  spread: 55, origin: { x: 0 } }), 300);
      setTimeout(() => alive && fire({ particleCount: 90, angle: 120, spread: 55, origin: { x: 1 } }), 500);
    })();
    return () => { alive = false; };
  }, [done]);

  useEffect(() => {
    if (!done) return;
    if (countdown <= 0) { onNavigate(movieId ? `/watch/${movieId}` : "/history"); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [done, countdown, movieId]);

  const aptosUrl = txHash
    ? `https://explorer.aptoslabs.com/txn/${txHash}?network=testnet`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md px-4">
      <div className="w-full max-w-md rounded-2xl bg-[#111] border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-8 py-8 space-y-6">

          {/* ── Success ── */}
          {done ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-green-500/15 border-2 border-green-500/40 flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-green-400/20 animate-ping" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white">Movie Published!</h3>
                <p className="text-sm text-gray-400">
                  <span className="text-white font-medium">"{movieTitle}"</span> is now live on the decentralized Shelby Network.
                </p>
              </div>
              {aptosUrl && (
                <a href={aptosUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-brand hover:text-brand/80 transition-colors">
                  View registration on Aptos Explorer ↗
                </a>
              )}
              <div className="flex gap-3">
                {movieId && (
                  <button onClick={() => onNavigate(`/watch/${movieId}`)}
                    className="px-5 py-2 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors">
                    Watch Now
                  </button>
                )}
                <button onClick={() => onNavigate("/history")}
                  className="px-5 py-2 rounded-lg bg-white/10 text-gray-300 font-semibold text-sm hover:bg-white/20 transition-colors">
                  My Library
                </button>
              </div>
              <p className="text-xs text-gray-600">Redirecting in {countdown}s…</p>
            </div>

          /* ── Error ── */
          ) : error ? (
            <div className="flex flex-col items-center gap-5">
              <div className="w-16 h-16 rounded-full bg-red-500/15 border-2 border-red-500/40 flex items-center justify-center">
                <X className="w-8 h-8 text-red-400" />
              </div>
              <div className="w-full space-y-2 text-center">
                <h3 className="text-lg font-bold text-white">Upload Failed</h3>
                <p className="text-xs text-gray-500">
                  Failed at: <span className="text-gray-300">{OVERLAY_STAGES[Math.min(stageIndex, 3)].label}</span>
                </p>
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-left">
                  <p className="text-sm text-red-300 break-words">{error}</p>
                </div>
              </div>
              {aptosUrl && (
                <a href={aptosUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  View partial transaction ↗
                </a>
              )}
              <button onClick={onRetry}
                className="w-full py-2.5 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors">
                Try Again
              </button>
            </div>

          /* ── Progress ── */
          ) : (
            <>
              <div className="text-center space-y-0.5">
                <p className="text-xs text-gray-500 font-mono truncate">"{movieTitle}"</p>
                <p className="text-sm text-gray-300 font-medium">
                  {OVERLAY_STAGES[displayStage].desc}
                </p>
              </div>

              {/* Stage pills */}
              <div className="flex gap-2">
                {OVERLAY_STAGES.map((s, i) => (
                  <div key={s.label} className="flex-1 space-y-1">
                    <div className={`h-1 rounded-full transition-all duration-500 ${
                      i < displayStage ? "bg-green-500"
                      : i === displayStage ? "bg-brand animate-pulse"
                      : "bg-gray-700/60"
                    }`} />
                    <p className={`text-[10px] text-center transition-colors ${
                      i < displayStage ? "text-green-400"
                      : i === displayStage ? "text-gray-300"
                      : "text-gray-600"
                    }`}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Stage 0 — chunk progress */}
              {displayStage === 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{assemblingMsg ?? "Uploading video chunks…"}</span>
                    <span>{chunkProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-brand rounded-full transition-all duration-300"
                      style={{ width: `${chunkProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Stage 1 — Aptos tx */}
              {displayStage === 1 && (
                <div className="space-y-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-300">
                    <div className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin shrink-0" />
                    <span>{txHash ? "Confirming transaction…" : "Waiting for Petra wallet…"}</span>
                  </div>
                  {aptosUrl && (
                    <a href={aptosUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand hover:text-brand/80 transition-colors">
                      View tx on Aptos Explorer ↗
                    </a>
                  )}
                </div>
              )}

              {/* Stage 2 & 3 — putBlob / finalize */}
              {displayStage >= 2 && (
                <div className="space-y-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-300">
                    <div className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin shrink-0" />
                    <span>{assemblingMsg ?? "Uploading to Shelby Network…"}</span>
                  </div>
                  {aptosUrl && (
                    <a href={aptosUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                      View registration tx ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── ThumbnailDropzone ──────────────────────────────────────────────────────────

interface ThumbnailDropzoneProps {
  onFile: (file: File | null) => void;
  capturedFrame?: File | null;
  error?: string;
}

function ThumbnailDropzone({ onFile, capturedFrame, error }: ThumbnailDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!capturedFrame) { setCapturedPreviewUrl(null); return; }
    const url = URL.createObjectURL(capturedFrame);
    setCapturedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capturedFrame]);

  const handle = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) { setSizeError("Only image files allowed"); return; }
    if (MAX_THUMBNAIL_MB > 0 && f.size > MAX_THUMBNAIL_MB * 1024 * 1024) {
      setSizeError(`Max thumbnail size is ${MAX_THUMBNAIL_MB} MB`);
      return;
    }
    setSizeError(null);
    if (preview) URL.revokeObjectURL(preview);
    const url = URL.createObjectURL(f);
    setPreview(url);
    onFile(f);
  }, [preview, onFile]);

  const clear = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSizeError(null);
    onFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [preview, onFile]);

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handle(f);
  }

  const displayError = sizeError ?? error;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-sm text-gray-400">
          Poster / Thumbnail <span className="text-gray-600 text-xs">(optional)</span>
        </p>
        <p className="text-xs text-gray-600">1280×720 recommended</p>
      </div>
      {preview ? (
        <div className="relative w-36 group">
          <img src={preview} alt="Thumbnail preview" className="w-full aspect-[2/3] object-cover rounded-xl" />
          <button
            type="button"
            onClick={clear}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <Trash2 className="w-3.5 h-3.5 text-white" />
          </button>
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black/60 to-transparent rounded-b-xl flex items-end justify-center pb-1">
            <p className="text-xs text-white/70">Click to change</p>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} className="absolute inset-0" />
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />
        </div>
      ) : capturedPreviewUrl ? (
        <div className="relative w-36 group">
          <img src={capturedPreviewUrl} alt="Auto-captured thumbnail" className="w-full aspect-[2/3] object-cover rounded-xl opacity-80" />
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/80 text-white font-medium">Auto</span>
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black/60 to-transparent rounded-b-xl flex items-end justify-center pb-1">
            <p className="text-xs text-white/70">Click to replace</p>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} className="absolute inset-0" />
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />
        </div>
      ) : (
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-3 w-36 aspect-[2/3] rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
            isDragging ? "border-brand bg-brand/10 scale-[1.02]"
            : displayError ? "border-red-500/50 bg-red-500/5"
            : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.03]"
          }`}
        >
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />
          <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
            isDragging ? "bg-brand/20" : "bg-white/5"
          }`}>
            <ImageIcon className={`w-4 h-4 ${isDragging ? "text-brand" : displayError ? "text-red-400" : "text-gray-500"}`} />
          </div>
          <p className="text-xs text-gray-500 text-center px-2 leading-tight">
            {isDragging ? "Drop image" : "Drop poster\nor click"}
          </p>
        </div>
      )}
      {displayError && <p className="text-red-400 text-xs mt-1">{displayError}</p>}
    </div>
  );
}

// ── CategoryChips ──────────────────────────────────────────────────────────────

interface CategoryChipsProps {
  selected: string[];
  onChange: (cats: string[]) => void;
  error?: string;
}

function CategoryChips({ selected, onChange, error }: CategoryChipsProps) {
  function toggle(cat: string) {
    onChange(selected.includes(cat) ? selected.filter((c) => c !== cat) : [...selected, cat]);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm text-gray-400">
          Categories <span className="text-red-500">*</span>
        </p>
        {selected.length > 0 && (
          <p className="text-xs text-gray-600">{selected.length} selected</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const active = selected.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggle(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${
                active
                  ? "bg-brand border-brand text-white shadow-sm shadow-brand/30"
                  : error
                  ? "bg-transparent border-red-500/30 text-gray-500 hover:border-white/30 hover:text-gray-300"
                  : "bg-transparent border-white/15 text-gray-400 hover:border-white/30 hover:text-gray-300"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>
      {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
    </div>
  );
}

// ── VideoDropzone ──────────────────────────────────────────────────────────────

interface VideoDropzoneProps {
  onFile: (file: File | null, duration: number) => void;
  label?: string;
  hint?: string;
  error?: string;
}

function VideoDropzone({ onFile, label, hint, error }: VideoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(async (f: File) => {
    if (!f.type.startsWith("video/")) { setSizeError("Only video files allowed"); return; }
    if (MAX_VIDEO_MB > 0 && f.size > MAX_VIDEO_MB * 1024 * 1024) {
      setSizeError(`Max video size is ${MAX_VIDEO_MB} MB`);
      return;
    }
    setSizeError(null);
    setFile(f);
    const duration = await extractVideoDuration(f);
    onFile(f, duration);
  }, [onFile]);

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handle(f);
  }

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const displayError = sizeError ?? error;

  return (
    <div>
      {(label || hint) && (
        <div className="flex items-baseline justify-between mb-1.5">
          {label && <p className="text-sm text-gray-400">{label} <span className="text-red-500">*</span></p>}
          {hint && <p className="text-xs text-gray-600">{hint}</p>}
        </div>
      )}
      <div
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200 ${
          isDragging ? "border-brand bg-brand/10 scale-[1.01] cursor-copy"
          : file ? "border-green-500/40 bg-green-500/5 cursor-default"
          : displayError ? "border-red-500/40 bg-red-500/5 cursor-pointer"
          : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.03] cursor-pointer"
        }`}
      >
        <input ref={inputRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />

        {file ? (
          <>
            <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white truncate max-w-[240px]">{file.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFile(null); setSizeError(null); onFile(null, 0); }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" /> Remove
            </button>
          </>
        ) : (
          <>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              isDragging ? "bg-brand/20" : "bg-white/5"
            }`}>
              {isDragging ? <Film className="w-5 h-5 text-brand" /> : <Upload className="w-5 h-5 text-gray-400" />}
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-300">
                {isDragging ? "Drop to add video" : "Drag & drop or click to browse"}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">MP4 · WebM · MKV · MOV · No size limit</p>
            </div>
          </>
        )}
      </div>
      {displayError && <p className="text-red-400 text-xs mt-1">{displayError}</p>}
    </div>
  );
}

// ── MovieUploadForm ────────────────────────────────────────────────────────────

export function MovieUploadForm({ onSuccess }: { onSuccess?: (redirectTo: string) => void }) {
  const router = useRouter();
  const { account, signAndSubmitTransaction, signMessage, connected, connect } = useWallet();
  const {
    register, handleSubmit, watch, control, setValue, reset,
    formState: { errors },
  } = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { type: "movie", accessType: "free", durationSeconds: 0, previewDuration: 0, episodes: [] },
  });
  const { fields: episodeFields, append: appendEpisode, remove: removeEpisode } =
    useFieldArray({ control, name: "episodes" });

  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [capturedFrameFile, setCapturedFrameFile] = useState<File | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [movieFile, setMovieFile] = useState<File | null>(null);
  const [movieFileError, setMovieFileError] = useState<string | null>(null);
  const [episodeFiles, setEpisodeFiles] = useState<Record<number, File>>({});

  const [stage, setStage] = useState<UploadStage>(null);
  const [stageIndex, setStageIndex] = useState(-1);
  const [chunkProgress, setChunkProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [assemblingMsg, setAssemblingMsg] = useState<string | null>(null);
  const [alphaSuccess, setAlphaSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [uploadedMovieId, setUploadedMovieId] = useState<string | null>(null);
  const [overlayActive, setOverlayActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [uploadAudit, setUploadAudit] = useState<{
    loading: boolean;
    balanceAPT: number;
    sUsdBalance: number;
    sUsdStorageCost: number;
  }>({ loading: false, balanceAPT: 0, sUsdBalance: 0, sUsdStorageCost: 0 });

  useEffect(() => {
    if (!alphaSuccess) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(id); if (onSuccess) onSuccess("/history"); else router.push("/history"); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [alphaSuccess]);

  useEffect(() => {
    if (!uploadedMovieId) return;
    router.prefetch(`/watch/${uploadedMovieId}`);
    router.prefetch("/history");
  }, [uploadedMovieId]);

  useEffect(() => {
    if (IS_ALPHA || !connected || !account) return;
    const addr = account.address;
    setUploadAudit((prev) => ({ ...prev, loading: true }));
    Promise.all([
      aptosTestnet.getAccountAPTAmount({ accountAddress: addr }).catch(() => 0),
      fetchSUsdBalance(addr),
    ]).then(([aptOctas, sUsd]) => {
      setUploadAudit((prev) => ({
        ...prev,
        loading: false,
        balanceAPT: aptOctas / 1e8,
        sUsdBalance: sUsd,
      }));
    }).catch(() => setUploadAudit((prev) => ({ ...prev, loading: false })));
  }, [connected, account?.address]);

  const contentType = watch("type");
  const accessType = watch("accessType");
  const durationSeconds = watch("durationSeconds");
  const watchedPrice = watch("priceApt");
  const description = watch("description") ?? "";

  // Dynamic max price: duration_minutes × 0.5 APT (only meaningful for movies)
  const durationMinutes = Math.floor(durationSeconds / 60);
  const maxPriceApt = durationMinutes > 0 ? parseFloat((durationMinutes * PRICE_PER_MINUTE_APT).toFixed(3)) : 0;
  const priceUnlocked = contentType === "movie"
    ? movieFile !== null && durationSeconds > 0
    : episodeFields.length > 0 && Object.keys(episodeFiles).length > 0;

  function advanceStage(index: number) {
    setStageIndex(index);
    setStage(UPLOAD_STAGES[index]);
    setChunkProgress(0);
  }

  function handleStage(label: string) {
    setStage(label);
    const idx = STAGE_LABEL_TO_INDEX[label];
    if (idx !== undefined) setStageIndex(idx);
  }

  function resetOverlay() {
    setOverlayActive(false);
    setStage(null);
    setStageIndex(-1);
    setSubmitError(null);
    setDone(false);
    setTxHash(null);
    setUploadedMovieId(null);
    setChunkProgress(0);
    setAssemblingMsg(null);
    reset();
  }

  async function onSubmit(values: FormValues) {
    if (!IS_ALPHA && (!connected || !account)) {
      setSubmitError("Connect your Petra wallet first");
      return;
    }

    let valid = true;
    if (selectedCategories.length === 0) { setCategoryError("Select at least one category"); valid = false; }
    if (values.type === "movie" && !movieFile) { setMovieFileError("Video file required"); valid = false; }
    if (values.type === "series" && episodeFields.some((_, i) => !episodeFiles[i])) {
      setSubmitError("All episodes need a video file"); valid = false;
    }
    if (!valid) return;

    setSubmitError(null);
    setThumbnailError(null);
    setCategoryError(null);
    setMovieFileError(null);
    setDone(false);

    // Alpha mode: fully simulated upload — Petra signMessage + fake 3-stage progress
    if (IS_ALPHA) {
      try {
        if (connected && signMessage) {
          try {
            await signMessage({ message: "Authorize upload to Shelby Alpha Node", nonce: Date.now().toString() });
          } catch {
            // user cancelled — still proceed with demo
          }
        }

        advanceStage(0);
        await new Promise((r) => setTimeout(r, 900));
        advanceStage(1);
        await new Promise((r) => setTimeout(r, 1400));
        advanceStage(2);
        await new Promise((r) => setTimeout(r, 700));

        const sessionMovie: MovieDto = {
          id: `alpha-upload-${Date.now()}`,
          type: values.type,
          title: values.title,
          description: values.description,
          thumbnailUrl: thumbnailFile
            ? URL.createObjectURL(thumbnailFile)
            : capturedFrameFile
            ? URL.createObjectURL(capturedFrameFile)
            : getRandomAlphaThumbnail(values.title),
          categories: selectedCategories,
          priceAPT: parseFloat(values.priceApt) || 0,
          accessType: values.accessType,
          isFeatured: values.isFeatured ?? false,
          status: "written",
          createdAt: new Date().toISOString(),
          durationSeconds: values.durationSeconds || 0,
          previewDuration: values.previewDuration || 0,
          creatorAddress: account?.address ?? "alpha",
          episodes: [],
        };
        const existing: MovieDto[] = JSON.parse(sessionStorage.getItem("alpha_session_uploads") ?? "[]");
        sessionStorage.setItem("alpha_session_uploads", JSON.stringify([...existing, sessionMovie]));

        setDone(true);
        setStage(null);
        setAlphaSuccess(true);
      } catch {
        setStage(null);
      }
      return;
    }

    const walletAddress = account!.address;
    const mockVideoUrl = process.env.NEXT_PUBLIC_MOCK_VIDEO_URL ?? "";

    try {
      const priceAPT = parseFloat(values.priceApt) || 0;
      const priceOctas = Math.round(priceAPT * APT_TO_OCTAS);

      if (values.type === "movie") {
        let blobId: string;
        if (IS_ALPHA) {
          advanceStage(0);
          blobId = mockVideoUrl || `alpha-mock-${Date.now()}`;
        } else {
          setOverlayActive(true);
          setTxHash(null);
          setUploadedMovieId(null);
          setStageIndex(0);
          blobId = await uploadBlob(
            movieFile!, walletAddress, signAndSubmitTransaction,
            (pct) => setChunkProgress(pct),
            (label) => handleStage(label),
            (msg) => setAssemblingMsg(msg),
            (hash) => setTxHash(hash),
          );
        }

        const movieRes = await fetch(`${API_URL}/api/movies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "movie",
            title: values.title,
            description: values.description,
            thumbnailUrl: URL.createObjectURL(thumbnailFile ?? capturedFrameFile!),
            categories: selectedCategories,
            priceAPT,
            priceOctas,
            accessType: values.accessType,
            isFeatured: values.isFeatured ?? false,
            creatorAddress: walletAddress,
            durationSeconds: values.durationSeconds || 0,
            previewDuration: values.previewDuration || 0,
            blobName: blobId,
            status: "written",
          }),
        });
        if (!movieRes.ok) throw new Error("Failed to save movie metadata");
        const { id: newMovieId } = await movieRes.json();
        if (newMovieId) setUploadedMovieId(newMovieId);
      } else {
        if (!IS_ALPHA) {
          setOverlayActive(true);
          setTxHash(null);
          setUploadedMovieId(null);
        }

        const episodeBlobs = await Promise.all(
          values.episodes.map(async (ep, idx) => {
            let blobId: string;
            if (IS_ALPHA) {
              advanceStage(idx % 3 as 0 | 1 | 2);
              blobId = mockVideoUrl || `alpha-mock-ep${ep.episodeNumber}-${Date.now()}`;
            } else {
              setStageIndex(0);
              setTxHash(null);
              blobId = await uploadBlob(
                episodeFiles[idx], walletAddress, signAndSubmitTransaction,
                (pct) => setChunkProgress(pct),
                (label) => handleStage(label),
                (msg) => setAssemblingMsg(msg),
                (hash) => setTxHash(hash),
              );
            }
            return { episodeNumber: ep.episodeNumber, title: ep.title, blobName: blobId, duration: ep.duration };
          })
        );

        const movieRes = await fetch(`${API_URL}/api/movies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "series",
            title: values.title,
            description: values.description,
            thumbnailUrl: URL.createObjectURL(thumbnailFile ?? capturedFrameFile!),
            categories: selectedCategories,
            priceAPT,
            priceOctas,
            accessType: values.accessType,
            isFeatured: values.isFeatured ?? false,
            creatorAddress: walletAddress,
            previewDuration: values.previewDuration || 0,
            episodes: episodeBlobs,
            status: "written",
          }),
        });
        if (!movieRes.ok) throw new Error("Failed to save series metadata");
        const { id: newMovieId } = await movieRes.json();
        if (newMovieId) setUploadedMovieId(newMovieId);
      }

      setDone(true);
      setStage(null);
      setAssemblingMsg(null);
    } catch (err: any) {
      setSubmitError(err.message ?? "Upload failed");
      setStage(null);
      setAssemblingMsg(null);
    }
  }

  const isUploading = stage !== null;

  // Submit is ready when all required out-of-RHF state is present
  const isReady =
    !isUploading &&
    selectedCategories.length > 0 &&
    (contentType === "series" || movieFile !== null);

  const insufficientAPT = !IS_ALPHA && !uploadAudit.loading && uploadAudit.balanceAPT > 0 && uploadAudit.balanceAPT < 0.005;
  const insufficientSUsd = !IS_ALPHA && !uploadAudit.loading && uploadAudit.sUsdStorageCost > 0 && uploadAudit.sUsdBalance < uploadAudit.sUsdStorageCost;
  const submitLabel = isUploading
    ? stage
    : insufficientAPT && insufficientSUsd ? "Insufficient APT + ShelbyUSD"
    : insufficientAPT ? "Insufficient APT"
    : insufficientSUsd ? "Insufficient ShelbyUSD"
    : `Publish ${contentType === "series" ? "Series" : "Movie"}`;

  // ── Wallet guard ──────────────────────────────────────────────────────────
  if (!IS_ALPHA && !connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center max-w-xl">
        <div className="w-14 h-14 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center">
          <Film className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-white">Connect Wallet to Upload</h2>
          <p className="text-gray-400 text-sm max-w-xs">
            Your Petra wallet is required to sign the on-chain blob registration on Shelby Protocol.
          </p>
        </div>
        <button
          type="button"
          onClick={() => connect("Petra" as WalletName<"Petra">)}
          className="px-6 py-2.5 rounded-md bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors"
        >
          Connect Petra Wallet
        </button>
      </div>
    );
  }

  if (alphaSuccess) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center max-w-xl mx-auto">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center animate-scale-in">
            <CheckCircle className="w-12 h-12 text-green-400" />
          </div>
          <div className="absolute inset-0 rounded-full border-2 border-green-400/20 animate-ping" />
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-bold text-white">Movie Published Successfully!</h3>
          <p className="text-gray-400 text-sm max-w-sm">Your movie is now live on the Shelby Alpha Node.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { if (onSuccess) onSuccess("/"); else router.push("/"); }}
            className="px-6 py-2.5 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors"
          >
            Go to Home
          </button>
          <button
            onClick={() => { if (onSuccess) onSuccess("/history"); else router.push("/history"); }}
            className="px-6 py-2.5 rounded-lg bg-white/10 text-gray-300 font-semibold text-sm hover:bg-white/20 transition-colors"
          >
            View in Library
          </button>
        </div>
        <p className="text-xs text-gray-600">Redirecting to Library in {countdown}s…</p>
      </div>
    );
  }

  return (
    <>
      {overlayActive && !IS_ALPHA && (
        <UploadProgressOverlay
          stageIndex={stageIndex}
          chunkProgress={chunkProgress}
          assemblingMsg={assemblingMsg}
          txHash={txHash}
          done={done}
          error={submitError}
          movieTitle={watch("title") || "Your Movie"}
          movieId={uploadedMovieId}
          onRetry={resetOverlay}
          onNavigate={(path) => { resetOverlay(); if (onSuccess) onSuccess(path); else router.push(path); }}
        />
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">
      <h2 className="text-xl font-bold text-white">Creator Studio</h2>

      {IS_ALPHA && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <span className="text-amber-400 text-xs font-bold mt-0.5 shrink-0">ALPHA</span>
          <p className="text-amber-300/80 text-xs leading-relaxed">
            Alpha demo mode — a Petra signature request simulates on-chain registration. No real APT is spent.
          </p>
        </div>
      )}

      {/* Content type — segmented control */}
      <div>
        <p className="text-sm text-gray-400 mb-2">Content Type</p>
        <div className="inline-flex rounded-lg bg-gray-800/80 p-1 gap-1">
          {(["movie", "series"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setValue("type", t, { shouldValidate: true })}
              className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                contentType === t
                  ? "bg-brand text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t === "movie" ? "🎬 Movie" : "📺 Series"}
            </button>
          ))}
        </div>
        {/* hidden RHF field */}
        <input type="hidden" {...register("type")} />
      </div>

      {/* Access type */}
      <div>
        <p className="text-sm text-gray-400 mb-2">Access</p>
        <div className="flex gap-3">
          {(["free", "paid"] as const).map((a) => (
            <label
              key={a}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                accessType === a
                  ? a === "free"
                    ? "border-green-500 bg-green-600/20 text-green-400"
                    : "border-brand bg-brand/20 text-brand"
                  : "border-white/10 text-gray-500 hover:border-white/20"
              }`}
            >
              <input type="radio" value={a} {...register("accessType")} className="sr-only" />
              <span className="text-sm font-medium">{a === "free" ? "🆓 Free" : "💳 Paid"}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Thumbnail dropzone */}
      <ThumbnailDropzone
        onFile={(file) => { setThumbnailFile(file); if (file) setThumbnailError(null); }}
        capturedFrame={capturedFrameFile}
        error={thumbnailError ?? undefined}
      />

      {/* Title */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label className="text-sm text-gray-400">
            Title <span className="text-red-500">*</span>
          </label>
          <span className={`text-xs ${(watch("title") ?? "").length > 90 ? "text-yellow-500" : "text-gray-600"}`}>
            {(watch("title") ?? "").length}/100
          </span>
        </div>
        <input
          {...register("title", {
            required: "Title is required",
            minLength: { value: 3, message: "At least 3 characters" },
            maxLength: { value: 100, message: "Max 100 characters" },
          })}
          className={`w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm transition-colors ${
            errors.title ? "border border-red-500/60 bg-red-500/5" : "border border-transparent"
          }`}
          placeholder={contentType === "series" ? "e.g. Breaking Bad" : "e.g. Inception"}
        />
        {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title.message}</p>}
      </div>

      {/* Category chips */}
      <CategoryChips
        selected={selectedCategories}
        onChange={(cats) => { setSelectedCategories(cats); if (cats.length > 0) setCategoryError(null); }}
        error={categoryError ?? undefined}
      />

      {/* Description */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label className="text-sm text-gray-400">
            Description <span className="text-red-500">*</span>
          </label>
          <span className={`text-xs ${description.length > 450 ? "text-yellow-500" : "text-gray-600"}`}>
            {description.length}/500
          </span>
        </div>
        <textarea
          {...register("description", {
            required: "Description is required",
            minLength: { value: 10, message: "At least 10 characters" },
            maxLength: { value: 500, message: "Max 500 characters" },
          })}
          rows={3}
          className={`w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm resize-none transition-colors ${
            errors.description ? "border border-red-500/60 bg-red-500/5" : "border border-transparent"
          }`}
          placeholder="What is this film about?"
        />
        {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description.message}</p>}
      </div>

      {/* Movie video dropzone */}
      {contentType === "movie" && (
        <div className="space-y-2">
          <VideoDropzone
            label="Video File"
            hint="MP4 · WebM · MKV · No size limit"
            onFile={(file, duration) => {
              setMovieFile(file);
              setMovieFileError(null);
              setValue("durationSeconds", duration > 0 ? duration : 0);
              setUploadAudit((prev) => ({
                ...prev,
                sUsdStorageCost: file ? (file.size / 1e6) * SUSD_PER_MB : 0,
              }));
              if (file && !thumbnailFile) {
                captureVideoFrame(file).then((frame) => setCapturedFrameFile(frame));
              } else if (!file) {
                setCapturedFrameFile(null);
              }
            }}
            error={movieFileError ?? undefined}
          />
          {durationSeconds > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/20">
              <Clock className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <p className="text-xs text-green-400">
                Duration detected: <span className="font-medium">{fmtDuration(durationSeconds)}</span>
                {maxPriceApt > 0 && (
                  <span className="ml-2 text-green-500/70">· max price {maxPriceApt} APT</span>
                )}
              </p>
            </div>
          )}
          <input type="hidden" {...register("durationSeconds", { valueAsNumber: true })} />
        </div>
      )}

      {/* Price — disabled until video+duration ready */}
      {accessType === "paid" && (
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label className={`text-sm ${priceUnlocked ? "text-gray-400" : "text-gray-600"}`}>
              Price (APT) <span className="text-red-500">*</span>
            </label>
            {priceUnlocked && maxPriceApt > 0 && (
              <p className="text-xs text-gray-600">0.001 – {maxPriceApt} APT</p>
            )}
            {!priceUnlocked && (
              <p className="text-xs text-gray-600">Upload video first to unlock</p>
            )}
          </div>
          <input
            type="number"
            step="0.001"
            min="0.001"
            disabled={!priceUnlocked}
            {...register("priceApt", {
              required: accessType === "paid" ? "Price is required" : false,
              validate: (v) => {
                if (accessType !== "paid") return true;
                const n = parseFloat(v);
                if (isNaN(n) || n < 0.001) return "Minimum price is 0.001 APT";
                if (maxPriceApt > 0 && n > maxPriceApt) return `Max price for this video is ${maxPriceApt} APT`;
                return true;
              },
            })}
            className={`w-full rounded-lg px-3 py-2 text-sm transition-colors ${
              !priceUnlocked
                ? "bg-gray-800/40 text-gray-600 cursor-not-allowed border border-transparent"
                : errors.priceApt
                ? "bg-red-500/5 text-white border border-red-500/60"
                : "bg-gray-800 text-white border border-transparent"
            }`}
            placeholder={priceUnlocked ? "e.g. 1.5" : "—"}
          />
          {errors.priceApt && <p className="text-red-400 text-xs mt-1">{errors.priceApt.message}</p>}
          {/* Real-time price vs max feedback */}
          {priceUnlocked && maxPriceApt > 0 && watchedPrice && !errors.priceApt && (
            <div className="mt-1 h-1 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-brand rounded-full transition-all duration-300"
                style={{ width: `${Math.min((parseFloat(watchedPrice) / maxPriceApt) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Preview duration */}
      {accessType === "paid" && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Free preview (seconds)
            {durationSeconds > 0 && (
              <span className="ml-2 text-gray-600 text-xs">
                max {Math.min(Math.floor(durationSeconds * 0.1), 600)}s
              </span>
            )}
          </label>
          <input
            type="number"
            min="0"
            {...register("previewDuration", {
              valueAsNumber: true,
              validate: (v) => {
                if (!v || v <= 0) return true;
                const max = Math.min(Math.floor((durationSeconds || 0) * 0.1), 600);
                if (durationSeconds > 0 && v > max) return `Max preview is ${max}s`;
                return true;
              },
            })}
            className={`w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm ${
              errors.previewDuration ? "border border-red-500/60" : ""
            }`}
            placeholder="e.g. 180"
          />
          {errors.previewDuration && (
            <p className="text-red-400 text-xs mt-1">{errors.previewDuration.message}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input type="checkbox" id="isFeatured" {...register("isFeatured")} className="accent-brand" />
        <label htmlFor="isFeatured" className="text-sm text-gray-300">Feature on homepage banner</label>
      </div>

      {/* Series episodes */}
      {contentType === "series" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">
              Episodes <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => appendEpisode({ episodeNumber: episodeFields.length + 1, title: "", duration: 0 })}
              className="text-xs px-3 py-1 rounded bg-white/10 text-gray-300 hover:bg-white/20 transition"
            >
              + Add Episode
            </button>
          </div>

          {episodeFields.map((field, idx) => (
            <div key={field.id} className="rounded-lg bg-gray-800/60 border border-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Episode {idx + 1}</span>
                <button type="button" onClick={() => removeEpisode(idx)}
                  className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </div>
              <input
                {...register(`episodes.${idx}.title`, {
                  required: true,
                  minLength: { value: 2, message: "Min 2 characters" },
                })}
                placeholder="Episode title"
                className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm"
              />
              <VideoDropzone
                hint="MP4 · WebM · MKV · No size limit"
                onFile={(file, duration) => {
                  setEpisodeFiles((prev) => file ? { ...prev, [idx]: file } : { ...prev });
                  if (duration > 0) setValue(`episodes.${idx}.duration`, duration);
                }}
              />
              {episodeFiles[idx] && watch(`episodes.${idx}.duration`) > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/8 border border-green-500/20">
                  <Clock className="w-3 h-3 text-green-400 shrink-0" />
                  <p className="text-xs text-green-400">
                    {fmtDuration(watch(`episodes.${idx}.duration`))} detected
                  </p>
                </div>
              )}
              <input type="hidden" {...register(`episodes.${idx}.duration`, { valueAsNumber: true })} />
              <input type="hidden" {...register(`episodes.${idx}.episodeNumber`, { valueAsNumber: true })} />
            </div>
          ))}

          {episodeFields.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-4 border border-dashed border-white/10 rounded-lg">
              Click "+ Add Episode" to get started.
            </p>
          )}
        </div>
      )}

      {/* 3-stage progress — only shown in alpha mode; real uploads use the overlay */}
      {isUploading && IS_ALPHA && (
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {UPLOAD_STAGES.map((s, i) => (
              <div key={s} className="flex-1 space-y-1">
                <div className={`h-1.5 rounded-full transition-all duration-500 ${
                  i < stageIndex ? "bg-green-500" : i === stageIndex ? "bg-brand animate-pulse" : "bg-gray-700"
                }`} />
                <p className="text-xs text-gray-500 text-center">{s}</p>
              </div>
            ))}
          </div>
          {stageIndex === 2 && !IS_ALPHA && (
            <p className="text-sm text-gray-400 text-center">{chunkProgress}% uploaded</p>
          )}
          {assemblingMsg && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-pulse">
              <span className="text-amber-400 text-lg shrink-0">⏳</span>
              <p className="text-amber-300 text-sm leading-relaxed">{assemblingMsg}</p>
            </div>
          )}
        </div>
      )}

      {done && !overlayActive && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-green-400 font-medium">Published successfully!</p>
            {IS_ALPHA && (
              <p className="text-xs text-green-500/70 mt-0.5">
                Movie Registered on Shelby (Alpha Node) — Transaction Simulated
              </p>
            )}
          </div>
        </div>
      )}

      {submitError && !overlayActive && (
        <p className="text-red-400 text-sm px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          {submitError}
        </p>
      )}

      {!IS_ALPHA && connected && isReady && !isUploading && (
        <TransactionAudit
          balanceAPT={uploadAudit.balanceAPT}
          priceAPT={0}
          gasCostAPT={0.005}
          loading={uploadAudit.loading}
          priceLabel="Registration fee"
          sUsdBalance={uploadAudit.sUsdBalance}
          sUsdStorageCost={uploadAudit.sUsdStorageCost > 0 ? uploadAudit.sUsdStorageCost : undefined}
          onRefreshBalance={() => {
            if (!account) return;
            const addr = account.address;
            setUploadAudit((prev) => ({ ...prev, loading: true }));
            Promise.all([
              aptosTestnet.getAccountAPTAmount({ accountAddress: addr }).catch(() => 0),
              fetchSUsdBalance(addr),
            ]).then(([aptOctas, sUsd]) => {
              setUploadAudit((prev) => ({
                ...prev,
                loading: false,
                balanceAPT: aptOctas / 1e8,
                sUsdBalance: sUsd,
              }));
            }).catch(() => setUploadAudit((prev) => ({ ...prev, loading: false })));
          }}
        />
      )}

      <button
        type="submit"
        disabled={!isReady || insufficientAPT || insufficientSUsd}
        className="w-full py-3 rounded-lg bg-brand text-white font-bold text-sm hover:bg-brand-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitLabel}
      </button>

      {!isReady && !isUploading && (
        <p className="text-center text-xs text-gray-600">
          {selectedCategories.length === 0 ? "Select a category" :
           contentType === "movie" && !movieFile ? "Add a video file" :
           "Fill in all required fields"} to continue
        </p>
      )}
    </form>
    </>
  );
}
