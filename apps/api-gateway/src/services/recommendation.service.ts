import { Types } from "mongoose";
import { Movie } from "../models/movie.model";
import { Progress } from "../models/progress.model";
import type { MovieDto, EpisodeDto } from "@shelby-movie/shared-types";

const MIN_WATCH_SECONDS = 30;
const HISTORY_DEPTH = 3;
const RESULT_LIMIT = 12;
const TRENDING_RATIO = 0.2;

function toDto(movie: any): MovieDto {
  return {
    id: movie._id?.toString() ?? movie.id,
    type: movie.type,
    title: movie.title,
    description: movie.description,
    thumbnailUrl: movie.thumbnailUrl,
    categories: movie.categories,
    priceAPT: movie.priceAPT,
    accessType: movie.accessType,
    isFeatured: movie.isFeatured,
    status: movie.status,
    creatorAddress: movie.creatorAddress,
    episodes: (movie.episodes ?? []).map(
      (ep: any): EpisodeDto => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        duration: ep.duration,
      })
    ),
    durationSeconds: movie.durationSeconds,
    previewDuration: movie.previewDuration,
    createdAt: movie.createdAt instanceof Date
      ? movie.createdAt.toISOString()
      : movie.createdAt,
  };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((c) => setB.has(c)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

async function fetchTrending(
  excludeIds: (Types.ObjectId | string)[],
  limit: number
): Promise<MovieDto[]> {
  const excludeObjectIds = excludeIds.map((id) =>
    id instanceof Types.ObjectId ? id : new Types.ObjectId(id.toString())
  );

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let agg = await Progress.aggregate([
    {
      $match: {
        movieId: { $nin: excludeObjectIds },
        lastPosition: { $gt: MIN_WATCH_SECONDS },
        updatedAt: { $gte: since24h },
      },
    },
    { $group: { _id: "$movieId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  if (agg.length === 0) {
    agg = await Progress.aggregate([
      {
        $match: {
          movieId: { $nin: excludeObjectIds },
          lastPosition: { $gt: MIN_WATCH_SECONDS },
        },
      },
      { $group: { _id: "$movieId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);
  }

  const ids = agg.map((d) => d._id);

  if (ids.length === 0) {
    const movies = await Movie.find({ status: "written" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return movies.map(toDto);
  }

  const movies = await Movie.find({ _id: { $in: ids }, status: "written" }).lean();
  return movies.map(toDto);
}

export async function getRecommendations(walletAddress?: string): Promise<MovieDto[]> {
  if (!walletAddress) {
    return fetchTrending([], RESULT_LIMIT);
  }

  const addr = walletAddress.toLowerCase();

  const history = await Progress.find({
    userAddress: addr,
    lastPosition: { $gt: MIN_WATCH_SECONDS },
  })
    .sort({ updatedAt: -1 })
    .limit(HISTORY_DEPTH * 4)
    .lean();

  if (history.length === 0) {
    return fetchTrending([], RESULT_LIMIT);
  }

  const watchedIds = [...new Set(history.map((p) => p.movieId.toString()))];
  const watchedObjectIds = watchedIds.map((id) => new Types.ObjectId(id));

  const watchedMovies = await Movie.find({
    _id: { $in: watchedObjectIds.slice(0, HISTORY_DEPTH) },
    status: "written",
  })
    .select("categories")
    .lean();

  const userCategories = [...new Set(watchedMovies.flatMap((m) => m.categories))];

  const trendingSlots = Math.max(1, Math.round(RESULT_LIMIT * TRENDING_RATIO));
  const contentSlots = RESULT_LIMIT - trendingSlots;

  const candidates = await Movie.find({
    status: "written",
    _id: { $nin: watchedObjectIds },
  })
    .select("_id categories")
    .lean();

  const topIds = candidates
    .map((m) => ({ id: m._id.toString(), score: jaccard(m.categories, userCategories) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, contentSlots)
    .map((s) => s.id);

  const contentMovies = await Movie.find({ _id: { $in: topIds } }).lean();

  const excludeForTrending = [...watchedIds, ...topIds];
  const trendingMovies = await fetchTrending(excludeForTrending, trendingSlots);

  return [...contentMovies.map(toDto), ...trendingMovies];
}
