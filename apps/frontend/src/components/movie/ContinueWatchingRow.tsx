"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { ContinueWatchingDto } from "@shelby-movie/shared-types";

function ProgressBar({ lastPosition, duration }: { lastPosition: number; duration: number }) {
  if (!duration) return null;
  const pct = Math.min((lastPosition / duration) * 100, 100);
  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
      <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="snap-start flex-none w-52 animate-pulse">
      <div className="aspect-video rounded-lg bg-gray-800" />
      <div className="mt-1.5 px-0.5 space-y-1.5">
        <div className="h-2.5 w-3/4 rounded bg-gray-700" />
        <div className="h-2 w-1/2 rounded bg-gray-800" />
      </div>
    </div>
  );
}

export function ContinueWatchingRow() {
  const { account, connected } = useWallet();
  const [items, setItems] = useState<ContinueWatchingDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !account) return;
    setLoading(true);
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/movies/home?walletAddress=${account.address}`
    )
      .then((r) => r.json())
      .then((d) => setItems(d.continueWatching ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [connected, account]);

  if (!connected) return null;

  if (loading) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white px-10">Continue Watching</h2>
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-10 pb-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white px-10">Continue Watching</h2>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-10 pb-2">
        {items.map(({ movie, episodeNumber, lastPosition }) => {
          const episodeDuration =
            movie.type === "series"
              ? (movie.episodes.find((e) => e.episodeNumber === episodeNumber)?.duration ?? 0)
              : 0;

          const href =
            movie.type === "series"
              ? `/watch/${movie.id}?episode=${episodeNumber}`
              : `/watch/${movie.id}`;

          return (
            <div key={`${movie.id}-${episodeNumber}`} className="snap-start flex-none w-52 group">
              <Link href={href}>
                <div className="relative aspect-video overflow-hidden rounded-lg bg-gray-800">
                  <Image
                    src={movie.thumbnailUrl}
                    alt={movie.title}
                    fill
                    className="object-cover transition group-hover:brightness-75"
                  />
                  <ProgressBar lastPosition={lastPosition} duration={episodeDuration} />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <span className="text-2xl">▶</span>
                  </div>
                </div>
                <div className="mt-1.5 px-0.5">
                  <p className="text-xs font-medium text-white truncate">{movie.title}</p>
                  {movie.type === "series" && (
                    <p className="text-xs text-gray-500">Episode {episodeNumber}</p>
                  )}
                </div>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
