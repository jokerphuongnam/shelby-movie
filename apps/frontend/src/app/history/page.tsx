"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/WalletButton";
import type { AccessDto, MovieDto, ProgressDto } from "@shelby-movie/shared-types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface HistoryEntry {
  access: AccessDto;
  movie: MovieDto | null;
  progress: ProgressDto | null;
}

async function fetchHistory(walletAddress: string): Promise<AccessDto[]> {
  const res = await fetch(`${API}/api/access/history?walletAddress=${walletAddress}`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchMovie(movieId: string): Promise<MovieDto | null> {
  const res = await fetch(`${API}/api/movies/${movieId}`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchProgress(walletAddress: string, movieId: string): Promise<ProgressDto | null> {
  const res = await fetch(`${API}/api/movies/progress?walletAddress=${walletAddress}&movieId=${movieId}`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.lastPosition > 0
    ? { movieId, episodeNumber: d.episodeNumber ?? 1, lastPosition: d.lastPosition, updatedAt: d.updatedAt }
    : null;
}

function formatSeconds(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function HistoryPage() {
  const { account, connected } = useWallet();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !account) return;

    setLoading(true);
    fetchHistory(account.address)
      .then(async (records) => {
        const withData = await Promise.all(
          records.map(async (access) => ({
            access,
            movie: await fetchMovie(access.movieId),
            progress: await fetchProgress(account.address, access.movieId),
          }))
        );
        setEntries(withData);
      })
      .finally(() => setLoading(false));
  }, [connected, account]);

  return (
    <div className="min-h-screen bg-cinema">
      <header className="flex items-center justify-between px-10 py-4 bg-black/60">
        <Link href="/" className="text-xl font-extrabold text-white">
          Shelby<span className="text-brand">Movie</span>
        </Link>
        <WalletButton />
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-white mb-8">My List</h1>

        {!connected && (
          <p className="text-gray-500">Connect your Petra wallet to see your purchases.</p>
        )}
        {connected && !loading && entries.length === 0 && (
          <p className="text-gray-500">No purchases yet.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {connected && loading &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-gray-800" />
                <div className="mt-2 px-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-gray-700" />
                  <div className="h-2.5 w-1/2 rounded bg-gray-800" />
                </div>
              </div>
            ))
          }
          {entries.map(({ access, movie, progress }) => {
            if (!movie) return null;

            const watchHref =
              movie.type === "series" && progress
                ? `/watch/${movie.id}?episode=${progress.episodeNumber}`
                : `/watch/${movie.id}`;

            return (
              <Link key={access.id} href={watchHref} className="group block">
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-800">
                  <Image
                    src={movie.thumbnailUrl}
                    alt={movie.title}
                    fill
                    className="object-cover transition group-hover:scale-105 group-hover:brightness-75"
                  />
                  {progress && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div className="h-full bg-brand" style={{ width: "50%" }} />
                    </div>
                  )}
                </div>
                <div className="mt-2 px-1">
                  <p className="text-sm font-medium text-white truncate">{movie.title}</p>
                  <p className="text-xs text-gray-500">
                    {progress
                      ? `${formatSeconds(progress.lastPosition)} watched`
                      : access.lastWatched
                      ? `Watched ${new Date(access.lastWatched).toLocaleDateString()}`
                      : "Not started"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
