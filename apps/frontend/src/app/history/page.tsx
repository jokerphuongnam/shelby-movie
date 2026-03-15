"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { NavHeader } from "@/components/layout/NavHeader";
import { Play, BookOpen, Upload, Clock, CheckCircle, Loader2, Trash2 } from "lucide-react";
import type { AccessDto, MovieDto, ProgressDto } from "@shelby-movie/shared-types";
import { ALPHA_MOVIES, getRandomAlphaThumbnail } from "@/lib/alpha-data";

const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

// ── data helpers ──────────────────────────────────────────────────────────────

interface LibraryEntry {
  access: AccessDto;
  movie: MovieDto;
  progress: ProgressDto | null;
}

async function fetchPurchased(walletAddress: string): Promise<LibraryEntry[]> {
  const res = await fetch(`${API}/api/access/history?walletAddress=${walletAddress}`);
  const records: AccessDto[] = res.ok ? await res.json() : [];

  const entries = await Promise.all(
    records.map(async (access) => {
      const [mRes, pRes] = await Promise.all([
        fetch(`${API}/api/movies/${access.movieId}`),
        fetch(`${API}/api/movies/progress?walletAddress=${walletAddress}&movieId=${access.movieId}`),
      ]);
      const movie: MovieDto | null = mRes.ok ? await mRes.json() : null;
      if (!movie) return null;
      const pd = pRes.ok ? await pRes.json() : null;
      const progress: ProgressDto | null =
        pd?.lastPosition > 0
          ? { movieId: access.movieId, episodeNumber: pd.episodeNumber ?? 1, lastPosition: pd.lastPosition, updatedAt: pd.updatedAt }
          : null;
      return { access, movie, progress };
    })
  );

  return entries.filter((e): e is LibraryEntry => e !== null);
}

async function fetchUploads(walletAddress: string): Promise<MovieDto[]> {
  const res = await fetch(`${API}/api/movies?creatorAddress=${walletAddress}`);
  return res.ok ? res.json() : [];
}

function fmtSeconds(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function calcPct(pos: number, total: number) {
  if (!total) return 0;
  return Math.min(Math.round((pos / total) * 100), 100);
}

// ── PosterCard ────────────────────────────────────────────────────────────────

function PosterCard({
  movie, href, sublabel, pct, badge,
}: {
  movie: MovieDto; href: string; sublabel: string; pct?: number; badge?: React.ReactNode;
}) {
  return (
    <Link href={href} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1a1a1a]">
        <Image
          src={movie.thumbnailUrl}
          alt={movie.title}
          fill
          className="object-cover transition duration-300 group-hover:scale-105 group-hover:brightness-[0.55]"
        />
        <div className="absolute inset-0 flex items-end justify-center pb-7 opacity-0 group-hover:opacity-100 transition-all duration-200">
          <span className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold shadow-xl">
            <Play className="w-3 h-3 fill-black" />
            Watch Now
          </span>
        </div>
        {pct !== undefined && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/20">
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        )}
        {badge && <div className="absolute top-2 left-2">{badge}</div>}
        <div className="absolute top-2 right-2">
          {movie.accessType === "free" ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-600/80 text-white font-semibold backdrop-blur-sm">FREE</span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded bg-black/80 text-amber-400 font-semibold border border-amber-500/40 backdrop-blur-sm">
              {movie.priceAPT.toFixed(2)} APT
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-0.5 px-0.5">
        <p className="text-sm font-medium text-white truncate">{movie.title}</p>
        <p className="text-xs text-gray-500 truncate">{sublabel}</p>
      </div>
    </Link>
  );
}

// ── UploadCard (alpha only — has unpublish button) ─────────────────────────────

function UploadCard({
  movie, onDelete, isRemoving,
}: {
  movie: MovieDto;
  onDelete: () => void;
  isRemoving: boolean;
}) {
  const thumbnail = movie.thumbnailUrl.startsWith("blob:")
    ? getRandomAlphaThumbnail(movie.id)
    : movie.thumbnailUrl;

  return (
    <div className="group">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1a1a1a]">
        <Link href={`/watch/${movie.id}`} className="absolute inset-0 z-0 block">
          <Image
            src={thumbnail}
            alt={movie.title}
            fill
            className="object-cover transition duration-300 group-hover:scale-105 group-hover:brightness-[0.55]"
          />
          <div className="absolute inset-0 flex items-end justify-center pb-7 opacity-0 group-hover:opacity-100 transition-all duration-200">
            <span className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold shadow-xl">
              <Play className="w-3 h-3 fill-black" />
              Watch Now
            </span>
          </div>
        </Link>

        {/* Status badge */}
        <div className="absolute top-2 left-2 z-10">
          {movie.status === "written" ? (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-600/80 text-white backdrop-blur-sm font-semibold">
              <CheckCircle className="w-2.5 h-2.5" />Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/80 text-black backdrop-blur-sm font-semibold">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />Processing
            </span>
          )}
        </div>

        {/* Access badge — fades out on hover to reveal delete */}
        <div className="absolute top-2 right-2 z-10 transition-opacity duration-150 group-hover:opacity-0">
          {movie.accessType === "free" ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-600/80 text-white font-semibold backdrop-blur-sm">FREE</span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded bg-black/80 text-amber-400 font-semibold border border-amber-500/40 backdrop-blur-sm">
              {movie.priceAPT.toFixed(2)} APT
            </span>
          )}
        </div>

        {/* Delete button — appears on hover */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          title="Unpublish"
        >
          <Trash2 className="w-3.5 h-3.5 text-white" />
        </button>

        {/* Removing overlay */}
        {isRemoving && (
          <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center gap-2 rounded-xl">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-white text-xs font-medium">Removing…</p>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-0.5 px-0.5">
        <p className="text-sm font-medium text-white truncate">{movie.title}</p>
        <p className="text-xs text-gray-500 truncate">
          {movie.type === "series" ? "Series" : "Movie"} · {new Date(movie.createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

// ── SkeletonGrid ──────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] rounded-xl bg-gray-800/60" />
          <div className="mt-2 space-y-1.5 px-0.5">
            <div className="h-3 w-3/4 rounded bg-gray-700/60" />
            <div className="h-2.5 w-1/2 rounded bg-gray-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body, cta, ctaHref }: {
  icon: React.ReactNode; title: string; body: string; cta: string; ctaHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-white/5 border border-white/8 flex items-center justify-center">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-white font-semibold text-lg">{title}</p>
        <p className="text-gray-500 text-sm max-w-xs">{body}</p>
      </div>
      <Link href={ctaHref} className="px-5 py-2 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors">
        {cta}
      </Link>
    </div>
  );
}

// ── LibraryPage ───────────────────────────────────────────────────────────────

type Tab = "purchased" | "uploads";

export default function LibraryPage() {
  const { account, connected, signMessage } = useWallet();
  const [tab, setTab] = useState<Tab>("purchased");
  const [purchased, setPurchased] = useState<LibraryEntry[]>([]);
  const [uploads, setUploads] = useState<MovieDto[]>([]);
  const [loading, setLoading] = useState(false);

  const [confirmMovie, setConfirmMovie] = useState<MovieDto | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeToast, setRemoveToast] = useState(false);

  useEffect(() => {
    if (IS_ALPHA) {
      const alphaEntries: LibraryEntry[] = ALPHA_MOVIES.map((m) => ({
        access: { id: m.id, movieId: m.id, txHash: `alpha-${m.id}`, lastWatched: null, createdAt: m.createdAt },
        movie: m,
        progress: null,
      }));
      setPurchased(alphaEntries);
      try {
        const sessionUploads: MovieDto[] = JSON.parse(sessionStorage.getItem("alpha_session_uploads") ?? "[]");
        setUploads(sessionUploads);
      } catch {
        // ignore
      }
      return;
    }
    if (!connected || !account) return;
    setLoading(true);
    Promise.all([fetchPurchased(account.address), fetchUploads(account.address)])
      .then(([p, u]) => { setPurchased(p); setUploads(u); })
      .finally(() => setLoading(false));
  }, [connected, account]);

  async function handleUnpublish(movie: MovieDto) {
    setConfirmMovie(null);
    setRemovingId(movie.id);

    if (connected && signMessage) {
      try {
        await signMessage({
          message: `Confirming unpublish request for "${movie.title}"`,
          nonce: Date.now().toString(),
        });
      } catch {
        // cancelled — proceed anyway
      }
    }

    await new Promise((r) => setTimeout(r, 1500));

    setUploads((prev) => prev.filter((m) => m.id !== movie.id));
    try {
      const existing: MovieDto[] = JSON.parse(sessionStorage.getItem("alpha_session_uploads") ?? "[]");
      sessionStorage.setItem("alpha_session_uploads", JSON.stringify(existing.filter((m) => m.id !== movie.id)));
    } catch {
      // ignore
    }

    setRemovingId(null);
    setRemoveToast(true);
    setTimeout(() => setRemoveToast(false), 3000);
  }

  const tabs: { id: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: "purchased", label: "Purchased",  count: purchased.length, icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: "uploads",   label: "My Uploads", count: uploads.length,   icon: <Upload className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#050505]">
      <NavHeader />

      {/* Remove success toast */}
      {removeToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5 px-5 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold shadow-2xl animate-toast-in whitespace-nowrap">
          <CheckCircle className="w-4 h-4 shrink-0" />
          Movie has been successfully removed from your library.
        </div>
      )}

      {/* Confirm unpublish modal */}
      {confirmMovie && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-white font-bold">Unpublish Movie</p>
                <p className="text-gray-500 text-xs">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              Are you sure you want to unpublish{" "}
              <span className="text-white font-medium">"{confirmMovie.title}"</span>?
              {" "}This action cannot be undone on the Shelby Alpha Node.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setConfirmMovie(null)}
                className="flex-1 py-2.5 rounded-lg bg-white/8 text-gray-300 text-sm font-medium hover:bg-white/15 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUnpublish(confirmMovie)}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors"
              >
                Unpublish
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">My Collection</h1>
          <p className="text-gray-500 text-sm mt-1">Your purchased films and uploaded content</p>
        </div>

        {!connected && !IS_ALPHA ? (
          <EmptyState
            icon={<BookOpen className="w-7 h-7 text-gray-500" />}
            title="Connect your wallet"
            body="Link your Petra wallet to view your purchased films and creator uploads."
            cta="Browse Movies"
            ctaHref="/"
          />
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex items-center gap-1 mb-8 border-b border-white/[0.08]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab === t.id ? "text-white" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {!loading && t.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                      tab === t.id ? "bg-brand text-white" : "bg-white/10 text-gray-400"
                    }`}>
                      {t.count}
                    </span>
                  )}
                  {tab === t.id && (
                    <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-brand rounded-t" />
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <SkeletonGrid />
            ) : tab === "purchased" ? (
              purchased.length === 0 ? (
                <EmptyState
                  icon={<BookOpen className="w-7 h-7 text-gray-500" />}
                  title="No purchases yet"
                  body="Films you buy on Shelby Protocol will appear here."
                  cta="Browse Movies"
                  ctaHref="/"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                  {purchased.map(({ access, movie, progress }) => {
                    const watchHref =
                      movie.type === "series" && progress
                        ? `/watch/${movie.id}?episode=${progress.episodeNumber}`
                        : `/watch/${movie.id}`;
                    const pct = progress ? calcPct(progress.lastPosition, movie.durationSeconds ?? 0) : 0;
                    const sublabel = progress
                      ? `${fmtSeconds(progress.lastPosition)} watched`
                      : access.lastWatched
                      ? `Owned · ${new Date(access.lastWatched).toLocaleDateString()}`
                      : "Not started";

                    return (
                      <PosterCard
                        key={access.id}
                        movie={movie}
                        href={watchHref}
                        sublabel={sublabel}
                        pct={pct}
                        badge={
                          pct > 0 ? (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white backdrop-blur-sm">
                              <Clock className="w-2.5 h-2.5" />{pct}%
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </div>
              )
            ) : (
              uploads.length === 0 ? (
                <EmptyState
                  icon={<Upload className="w-7 h-7 text-gray-500" />}
                  title="Nothing uploaded yet"
                  body="Films you publish to Shelby Protocol will appear here."
                  cta="Upload a Film"
                  ctaHref="/upload"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                  {uploads.map((movie) =>
                    IS_ALPHA ? (
                      <UploadCard
                        key={movie.id}
                        movie={movie}
                        onDelete={() => setConfirmMovie(movie)}
                        isRemoving={removingId === movie.id}
                      />
                    ) : (
                      <PosterCard
                        key={movie.id}
                        movie={movie}
                        href={`/watch/${movie.id}`}
                        sublabel={`${movie.type === "series" ? "Series" : "Movie"} · ${new Date(movie.createdAt).toLocaleDateString()}`}
                        badge={
                          movie.status === "written" ? (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-600/80 text-white backdrop-blur-sm font-semibold">
                              <CheckCircle className="w-2.5 h-2.5" />Live
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/80 text-black backdrop-blur-sm font-semibold">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />Processing
                            </span>
                          )
                        }
                      />
                    )
                  )}
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
