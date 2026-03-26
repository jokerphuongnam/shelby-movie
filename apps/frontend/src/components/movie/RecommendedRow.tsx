"use client";

import { useEffect, useState } from "react";
import type { MovieDto } from "@shelby-movie/shared-types";
import { MovieRow } from "./MovieRow";
import { ALPHA_MOVIES, getAlphaPurchased, getAlphaWatchHistory } from "@/lib/alpha-data";
import { useUserIdentity } from "@/hooks/useUserIdentity";

const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((c) => setB.has(c)).length;
  return intersection / new Set([...a, ...b]).size;
}

function buildAlphaRecommendations(): { movies: MovieDto[]; label: string; personalized: boolean } {
  const watchHistory = getAlphaWatchHistory();
  const purchased = getAlphaPurchased();
  const watchedIds = new Set([...watchHistory.map((h) => h.movieId), ...purchased]);
  const userCategories = [...new Set([
    ...watchHistory.flatMap((h) => h.categories),
    ...ALPHA_MOVIES.filter((m) => purchased.includes(m.id)).flatMap((m) => m.categories),
  ])];

  if (userCategories.length === 0) {
    return { movies: [...ALPHA_MOVIES].sort((a, b) => b.priceAPT - a.priceAPT), label: "Trending Now", personalized: false };
  }

  const scored = ALPHA_MOVIES.filter((m) => !watchedIds.has(m.id))
    .map((m) => ({ movie: m, score: jaccard(m.categories, userCategories) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.movie);

  return {
    movies: scored.length > 0 ? scored : ALPHA_MOVIES.filter((m) => !purchased.includes(m.id)),
    label: "Recommended for You",
    personalized: true,
  };
}

export function RecommendedRow() {
  const { userId, isGuest } = useUserIdentity();
  const [movies, setMovies] = useState<MovieDto[]>([]);
  const [label, setLabel] = useState("Trending Now");
  const [personalized, setPersonalized] = useState(false);

  useEffect(() => {
    if (IS_ALPHA) {
      const result = buildAlphaRecommendations();
      setMovies(result.movies);
      setLabel(result.label);
      setPersonalized(result.personalized);
      return;
    }
    if (!userId) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/recommendations?walletAddress=${userId}`)
      .then((r) => r.json())
      .then((data: MovieDto[]) => {
        setMovies(data);
        setLabel(userId.startsWith("guest_") ? "Trending Now" : "Recommended for You");
        setPersonalized(!userId.startsWith("guest_"));
      })
      .catch(() => {});
  }, [userId]);

  if (movies.length === 0) return null;

  return (
    <div className="space-y-1">
      <MovieRow title={label} movies={movies} />
      {isGuest && personalized && (
        <p className="text-xs text-gray-600 px-10">
          Connect wallet to save your personalized feed across devices.
        </p>
      )}
    </div>
  );
}
