"use client";

import { useState, useRef, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network, Hex } from "@aptos-labs/ts-sdk";
import { Upload, CheckCircle, Film, X } from "lucide-react";

const CHUNK_SIZE = 5 * 1024 * 1024;

const UPLOAD_STAGES = ["Commitments", "Register on Aptos", "Put to Shelby RPC"] as const;
type UploadStage = (typeof UPLOAD_STAGES)[number] | null;

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
  categories: string[];
  description: string;
  priceApt: string;
  durationSeconds: number;
  previewDuration: number;
  isFeatured: boolean;
  thumbnailFile: FileList;
  episodes: EpisodeInput[];
}

const aptosNodeUrl = process.env.NEXT_PUBLIC_APTOS_NODE_URL;
const aptos = new Aptos(
  aptosNodeUrl
    ? new AptosConfig({ fullnode: aptosNodeUrl })
    : new AptosConfig({ network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET })
);

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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

async function uploadBlob(
  videoFile: File,
  walletAddress: string,
  signAndSubmitTransaction: (tx: any) => Promise<{ hash: string }>,
  onProgress: (pct: number) => void
): Promise<string> {
  // ── Stage 1: Compute Clay commitment hash ────────────────────────────────
  const commitFormData = new FormData();
  commitFormData.append("video", videoFile);

  const commitRes = await fetch(`${STREAM_URL}/upload/commitments`, { method: "POST", body: commitFormData });
  if (!commitRes.ok) throw new Error("Failed to calculate commitments");

  const {
    uploadSessionId,
    blobName,
    blobMerkleRootHex,
    expirationMicros,
    numChunksets,
    blobSize,
    encoding,
  } = await commitRes.json();

  // ── Stage 2: Register blob on Aptos ──────────────────────────────────────
  // register_blob(blobName, expirationMicros, merkleRoot: vector<u8>, numChunksets, blobSize, 0, encoding)
  // Argument types match the Move function signature in the Shelby Protocol contract.
  const merkleRootBytes = Hex.fromHexInput(blobMerkleRootHex).toUint8Array();

  const registerTx = await signAndSubmitTransaction({
    data: {
      function: `${process.env.NEXT_PUBLIC_SHELBY_CONTRACT}::blob_metadata::register_blob`,
      typeArguments: [],
      functionArguments: [
        blobName,                   // String — blob path under owner namespace
        expirationMicros,           // u64 string — expiry in microseconds
        merkleRootBytes,            // vector<u8> — Clay erasure coding merkle root
        Math.trunc(numChunksets),   // u64 — number of 10 MiB chunksets
        Math.trunc(blobSize),       // u64 — total blob size in bytes
        0,                          // u64 — payment tier (0 = default, SDK TODO)
        Math.trunc(encoding),       // u64 — erasure scheme enum (0 = ClayCode_16_10)
      ],
    },
    options: { maxGasAmount: 10000 },
  });

  await aptos.waitForTransaction({ transactionHash: registerTx.hash });

  // ── Confirm with stream-node (parses on-chain event, returns composite blobId) ──
  const blobIdRes = await fetch(`${STREAM_URL}/upload/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: registerTx.hash, uploadSessionId, walletAddress }),
  });
  if (!blobIdRes.ok) throw new Error("Failed to confirm blob registration");
  const { blobId } = await blobIdRes.json();

  // ── Stage 3: Chunked upload to Shelby RPC ────────────────────────────────
  const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = videoFile.slice(start, Math.min(start + CHUNK_SIZE, videoFile.size));
    const chunkForm = new FormData();
    chunkForm.append("chunk", chunk);
    chunkForm.append("chunkIndex", String(i));
    chunkForm.append("totalChunks", String(totalChunks));
    chunkForm.append("uploadSessionId", uploadSessionId);
    chunkForm.append("blobId", blobId);
    const chunkRes = await fetch(`${STREAM_URL}/upload/chunk`, { method: "POST", body: chunkForm });
    if (!chunkRes.ok) throw new Error(`Chunk ${i + 1}/${totalChunks} failed`);
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  return blobId;
}

// ── VideoDropzone ──────────────────────────────────────────────────────────────

interface VideoDropzoneProps {
  onFile: (file: File, duration: number) => void;
  label?: string;
  error?: string;
}

function VideoDropzone({ onFile, label, error }: VideoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(async (f: File) => {
    if (!f.type.startsWith("video/")) return;
    setFile(f);
    const duration = await extractVideoDuration(f);
    onFile(f, duration);
  }, [onFile]);

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  }

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div>
      {label && <p className="text-sm text-gray-400 mb-1.5">{label}</p>}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200 ${
          isDragging
            ? "border-brand bg-brand/10 scale-[1.01] cursor-copy"
            : file
            ? "border-green-500/40 bg-green-500/5 cursor-default"
            : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.03] cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }}
        />

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
              onClick={(e) => { e.stopPropagation(); setFile(null); onFile(null as any, 0); }}
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
              {isDragging ? (
                <Film className="w-5 h-5 text-brand" />
              ) : (
                <Upload className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-300">
                {isDragging ? "Drop to add video" : "Drag & drop video or click to browse"}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">MP4 · MKV · MOV · AVI</p>
            </div>
          </>
        )}
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

// ── MovieUploadForm ────────────────────────────────────────────────────────────

export function MovieUploadForm() {
  const { account, signAndSubmitTransaction, connected, connect } = useWallet();
  const { register, handleSubmit, watch, control, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: { type: "movie", accessType: "free", durationSeconds: 0, previewDuration: 0, episodes: [] },
  });
  const { fields: episodeFields, append: appendEpisode, remove: removeEpisode } =
    useFieldArray({ control, name: "episodes" });

  // Video files are managed outside react-hook-form (no FileList — works with dropzone)
  const [movieFile, setMovieFile] = useState<File | null>(null);
  const [episodeFiles, setEpisodeFiles] = useState<Record<number, File>>({});

  const [stage, setStage] = useState<UploadStage>(null);
  const [stageIndex, setStageIndex] = useState(-1);
  const [chunkProgress, setChunkProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  const contentType = watch("type");
  const accessType = watch("accessType");
  const durationSeconds = watch("durationSeconds");

  function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbnailPreview(URL.createObjectURL(file));
  }

  function advanceStage(index: number) {
    setStageIndex(index);
    setStage(UPLOAD_STAGES[index]);
    setChunkProgress(0);
  }

  async function onSubmit(values: FormValues) {
    if (!connected || !account) { setError("Connect your Petra wallet first"); return; }

    if (values.type === "movie" && !movieFile) { setError("Select a video file"); return; }
    if (values.type === "series" && episodeFields.some((_, i) => !episodeFiles[i])) {
      setError("All episodes need a video file"); return;
    }

    setError(null);
    setDone(false);

    try {
      const thumbnailFile = values.thumbnailFile[0];
      const selectedCategories = Array.isArray(values.categories) ? values.categories : [values.categories];

      if (values.type === "movie") {
        advanceStage(0);
        const blobId = await uploadBlob(movieFile!, account.address, signAndSubmitTransaction, (pct) => {
          if (stageIndex === 2) setChunkProgress(pct);
        });
        advanceStage(2);

        const movieRes = await fetch(`${API_URL}/api/movies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "movie",
            title: values.title,
            description: values.description,
            thumbnailUrl: URL.createObjectURL(thumbnailFile),
            categories: selectedCategories,
            priceAPT: parseFloat(values.priceApt) || 0,
            accessType: values.accessType,
            isFeatured: values.isFeatured ?? false,
            creatorAddress: account.address,
            durationSeconds: values.durationSeconds || 0,
            previewDuration: values.previewDuration || 0,
            blobName: blobId,
          }),
        });
        if (!movieRes.ok) throw new Error("Failed to save movie metadata");
      } else {
        const episodeBlobs = await Promise.all(
          values.episodes.map(async (ep, idx) => {
            advanceStage(idx % 3 as 0 | 1 | 2);
            const blobId = await uploadBlob(episodeFiles[idx], account.address, signAndSubmitTransaction, (pct) => {
              setChunkProgress(pct);
            });
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
            thumbnailUrl: URL.createObjectURL(thumbnailFile),
            categories: selectedCategories,
            priceAPT: parseFloat(values.priceApt) || 0,
            accessType: values.accessType,
            isFeatured: values.isFeatured ?? false,
            creatorAddress: account.address,
            previewDuration: values.previewDuration || 0,
            episodes: episodeBlobs,
          }),
        });
        if (!movieRes.ok) throw new Error("Failed to save series metadata");
      }

      setDone(true);
      setStage(null);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
      setStage(null);
    }
  }

  const isUploading = stage !== null;

  // ── Wallet guard ────────────────────────────────────────────────────────────
  if (!connected) {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">
      <h2 className="text-xl font-bold text-white">Creator Studio</h2>

      {/* Content type */}
      <div className="flex gap-3">
        {(["movie", "series"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" value={t} {...register("type")} className="accent-brand" />
            <span className="text-sm text-gray-300 capitalize">{t}</span>
          </label>
        ))}
      </div>

      {/* Access type */}
      <div className="flex gap-4">
        {(["free", "paid"] as const).map((a) => (
          <label
            key={a}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
              accessType === a
                ? a === "free"
                  ? "border-green-500 bg-green-600/20 text-green-400"
                  : "border-brand bg-brand/20 text-brand"
                : "border-white/10 text-gray-500"
            }`}
          >
            <input type="radio" value={a} {...register("accessType")} className="sr-only" />
            <span className="text-sm font-medium capitalize">{a}</span>
          </label>
        ))}
      </div>

      {/* Thumbnail */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Thumbnail</label>
        <input
          type="file"
          accept="image/*"
          {...register("thumbnailFile", { required: "Thumbnail required" })}
          onChange={handleThumbnailChange}
          className="text-sm text-gray-300"
        />
        {thumbnailPreview && (
          <img src={thumbnailPreview} alt="preview" className="mt-3 w-40 rounded-lg object-cover aspect-[2/3]" />
        )}
        {errors.thumbnailFile && (
          <p className="text-red-400 text-xs mt-1">{errors.thumbnailFile.message}</p>
        )}
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Title</label>
        <input
          {...register("title", { required: "Title required" })}
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm"
          placeholder={contentType === "series" ? "My Series" : "My Movie"}
        />
        {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title.message}</p>}
      </div>

      {/* Categories */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Categories</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                value={cat}
                {...register("categories", { required: "Select at least one category" })}
                className="accent-brand"
              />
              <span className="text-sm text-gray-300">{cat}</span>
            </label>
          ))}
        </div>
        {errors.categories && (
          <p className="text-red-400 text-xs mt-1">{errors.categories.message}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Description</label>
        <textarea
          {...register("description")}
          rows={3}
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* Price */}
      {accessType === "paid" && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">Price (APT)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            {...register("priceApt", { required: "Price required for paid content" })}
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm"
            placeholder="1.5"
          />
          {errors.priceApt && <p className="text-red-400 text-xs mt-1">{errors.priceApt.message}</p>}
        </div>
      )}

      {/* Duration — auto-filled from video metadata; editable as override */}
      {contentType === "movie" && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Duration (seconds)
            {durationSeconds > 0 && (
              <span className="ml-2 text-gray-600 text-xs">
                {Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s — auto-detected
              </span>
            )}
          </label>
          <input
            type="number"
            min="1"
            {...register("durationSeconds", { valueAsNumber: true })}
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm"
            placeholder="Auto-detected from video"
          />
        </div>
      )}

      {/* Preview duration */}
      {accessType === "paid" && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Preview duration (seconds)
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
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm"
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

      {/* Movie video dropzone */}
      {contentType === "movie" && (
        <VideoDropzone
          label="Video File"
          onFile={(file, duration) => {
            setMovieFile(file);
            if (duration > 0) setValue("durationSeconds", duration);
          }}
          error={!movieFile && isUploading ? "Video required" : undefined}
        />
      )}

      {/* Series episodes */}
      {contentType === "series" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">Episodes</label>
            <button
              type="button"
              onClick={() => appendEpisode({ episodeNumber: episodeFields.length + 1, title: "", duration: 0 })}
              className="text-xs px-3 py-1 rounded bg-white/10 text-gray-300 hover:bg-white/20 transition"
            >
              + Add Episode
            </button>
          </div>

          {episodeFields.map((field, idx) => (
            <div key={field.id} className="rounded-lg bg-gray-800/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Episode {idx + 1}</span>
                <button type="button" onClick={() => removeEpisode(idx)} className="text-xs text-red-400 hover:text-red-300">
                  Remove
                </button>
              </div>
              <input
                {...register(`episodes.${idx}.title`, { required: true })}
                placeholder="Episode title"
                className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm"
              />
              <div className="flex gap-3 items-center">
                <input
                  type="number"
                  {...register(`episodes.${idx}.duration`, { valueAsNumber: true })}
                  placeholder="Duration (sec)"
                  className="w-36 bg-gray-700 text-white rounded px-3 py-1.5 text-sm"
                />
                {episodeFiles[idx] && (
                  <span className="text-xs text-gray-500">auto-detected</span>
                )}
              </div>
              <VideoDropzone
                onFile={(file, duration) => {
                  setEpisodeFiles((prev) => file ? { ...prev, [idx]: file } : { ...prev });
                  if (duration > 0) setValue(`episodes.${idx}.duration`, duration);
                }}
              />
            </div>
          ))}

          {episodeFields.length === 0 && (
            <p className="text-gray-600 text-sm">Add at least one episode.</p>
          )}
        </div>
      )}

      {/* 3-stage progress */}
      {isUploading && (
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {UPLOAD_STAGES.map((s, i) => (
              <div key={s} className="flex-1 space-y-1">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i < stageIndex ? "bg-green-500" : i === stageIndex ? "bg-brand animate-pulse" : "bg-gray-700"
                  }`}
                />
                <p className="text-xs text-gray-500 text-center">{s}</p>
              </div>
            ))}
          </div>
          {stageIndex === 2 && (
            <p className="text-sm text-gray-400 text-center">{chunkProgress}% uploaded</p>
          )}
        </div>
      )}

      {done && <p className="text-green-400 text-sm">Uploaded successfully!</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={isUploading}
        className="px-6 py-3 rounded bg-brand text-white font-bold hover:bg-brand-dark transition disabled:opacity-50"
      >
        {isUploading ? stage : `Publish ${contentType === "series" ? "Series" : "Movie"}`}
      </button>
    </form>
  );
}
