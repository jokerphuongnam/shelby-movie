"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network, Hex } from "@aptos-labs/ts-sdk";
import type { MovieDto } from "@shelby-movie/shared-types";
import { getRandomAlphaThumbnail } from "@/lib/alpha-data";
import { Upload, CheckCircle, Film, X, ImageIcon, Trash2, Clock } from "lucide-react";

const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_THUMBNAIL_MB = 0;
const MAX_VIDEO_MB = 0;
const PRICE_PER_MINUTE_APT = parseFloat(process.env.NEXT_PUBLIC_APT_PRICE_MULTIPLIER ?? "0.5");
const APT_TO_OCTAS = 1e8;
const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

const UPLOAD_STAGES_ONCHAIN = ["Commitments", "Register on Aptos", "Put to Shelby RPC"] as const;
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

const aptosNodeUrl = process.env.NEXT_PUBLIC_APTOS_NODE_URL;
const aptos = new Aptos(
  aptosNodeUrl
    ? new AptosConfig({ fullnode: aptosNodeUrl })
    : new AptosConfig({ network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET })
);

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

async function uploadBlob(
  videoFile: File,
  walletAddress: string,
  signAndSubmitTransaction: (tx: any) => Promise<{ hash: string }>,
  onProgress: (pct: number) => void
): Promise<string> {
  const commitFormData = new FormData();
  commitFormData.append("video", videoFile);

  const commitRes = await fetch(`${STREAM_URL}/upload/commitments`, { method: "POST", body: commitFormData });
  if (!commitRes.ok) throw new Error("Failed to calculate commitments");

  const { uploadSessionId, blobName, blobMerkleRootHex, expirationMicros, numChunksets, blobSize, encoding } =
    await commitRes.json();

  // register_blob(blobName, expirationMicros, merkleRoot: vector<u8>, numChunksets, blobSize, 0, encoding)
  const merkleRootBytes = Hex.fromHexInput(blobMerkleRootHex).toUint8Array();

  const registerTx = await signAndSubmitTransaction({
    data: {
      function: `${process.env.NEXT_PUBLIC_SHELBY_CONTRACT}::blob_metadata::register_blob`,
      typeArguments: [],
      functionArguments: [
        blobName,
        expirationMicros,
        merkleRootBytes,
        Math.trunc(numChunksets),
        Math.trunc(blobSize),
        0,                        // payment tier (SDK TODO)
        Math.trunc(encoding),
      ],
    },
    options: { maxGasAmount: 10000 },
  });

  await aptos.waitForTransaction({ transactionHash: registerTx.hash });

  const blobIdRes = await fetch(`${STREAM_URL}/upload/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: registerTx.hash, uploadSessionId, walletAddress }),
  });
  if (!blobIdRes.ok) throw new Error("Failed to confirm blob registration");
  const { blobId } = await blobIdRes.json();

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
  const { account, signAndSubmitTransaction, signMessage, connected, connect } = useWallet();
  const {
    register, handleSubmit, watch, control, setValue,
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
  const [alphaSuccess, setAlphaSuccess] = useState(false);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!alphaSuccess) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(id); onSuccess?.("/history"); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [alphaSuccess]);

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
        advanceStage(0);

        let blobId: string;
        if (IS_ALPHA) {
          blobId = mockVideoUrl || `alpha-mock-${Date.now()}`;
        } else {
          blobId = await uploadBlob(movieFile!, walletAddress, signAndSubmitTransaction, (pct) => {
            if (stageIndex === 2) setChunkProgress(pct);
          });
        }

        advanceStage(2);

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
      } else {
        const episodeBlobs = await Promise.all(
          values.episodes.map(async (ep, idx) => {
            advanceStage(idx % 3 as 0 | 1 | 2);

            let blobId: string;
            if (IS_ALPHA) {
              blobId = mockVideoUrl || `alpha-mock-ep${ep.episodeNumber}-${Date.now()}`;
            } else {
              blobId = await uploadBlob(episodeFiles[idx], walletAddress, signAndSubmitTransaction, (pct) => {
                setChunkProgress(pct);
              });
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
      }

      setDone(true);
      setStage(null);
    } catch (err: any) {
      setSubmitError(err.message ?? "Upload failed");
      setStage(null);
    }
  }

  const isUploading = stage !== null;

  // Submit is ready when all required out-of-RHF state is present
  const isReady =
    !isUploading &&
    selectedCategories.length > 0 &&
    (contentType === "series" || movieFile !== null);

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
            onClick={() => onSuccess?.("/")}
            className="px-6 py-2.5 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors"
          >
            Go to Home
          </button>
          <button
            onClick={() => onSuccess?.("/history")}
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

      {/* 3-stage progress */}
      {isUploading && (
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
        </div>
      )}

      {done && (
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

      {submitError && (
        <p className="text-red-400 text-sm px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={!isReady}
        className="w-full py-3 rounded-lg bg-brand text-white font-bold text-sm hover:bg-brand-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isUploading
          ? stage
          : `Publish ${contentType === "series" ? "Series" : "Movie"}`}
      </button>

      {!isReady && !isUploading && (
        <p className="text-center text-xs text-gray-600">
          {selectedCategories.length === 0 ? "Select a category" :
           contentType === "movie" && !movieFile ? "Add a video file" :
           "Fill in all required fields"} to continue
        </p>
      )}
    </form>
  );
}
