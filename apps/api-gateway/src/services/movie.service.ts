import { Movie, IMovie } from "../models/movie.model";
import { Progress } from "../models/progress.model";
import type {
  CreateMovieDto,
  MovieDto,
  EpisodeDto,
  HomeDto,
  HomeSection,
  ContinueWatchingDto,
} from "@shelby-movie/shared-types";

const HOME_CATEGORY_LIMIT = 6;
const HOME_ROW_LIMIT = 20;
const CONTINUE_WATCHING_LIMIT = 10;

function toDto(movie: IMovie): MovieDto {
  return {
    id: movie.id,
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
    // Strip blobName from episodes — frontend never needs the raw blob reference
    episodes: movie.episodes.map(
      (ep): EpisodeDto => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        duration: ep.duration,
      })
    ),
    durationSeconds: movie.durationSeconds,
    previewDuration: movie.previewDuration,
    createdAt: movie.createdAt.toISOString(),
  };
}

export async function getHomeData(walletAddress?: string): Promise<HomeDto> {
  const [featured, newReleases, allCategories] = await Promise.all([
    Movie.findOne({ isFeatured: true, status: "written" }),
    Movie.find({ status: "written" }).sort({ createdAt: -1 }).limit(HOME_ROW_LIMIT),
    Movie.distinct("categories", { status: "written" }),
  ]);

  const categoryMovies = await Promise.all(
    (allCategories as string[]).slice(0, HOME_CATEGORY_LIMIT).map(async (category) => {
      const movies = await Movie.find({ categories: category, status: "written" }).limit(HOME_ROW_LIMIT);
      return { title: category, movies: movies.map(toDto) } as HomeSection;
    })
  );

  const sections: HomeSection[] = [
    { title: "New Releases", movies: newReleases.map(toDto) },
    ...categoryMovies.filter((s) => s.movies.length > 0),
  ];

  // Fetch "Continue Watching" only if a wallet address is provided
  let continueWatching: ContinueWatchingDto[] = [];
  if (walletAddress) {
    const progressRecords = await Progress.find({
      userAddress: walletAddress.toLowerCase(),
      lastPosition: { $gt: 0 },
    })
      .sort({ updatedAt: -1 })
      .limit(CONTINUE_WATCHING_LIMIT)
      .lean();

    const moviesForProgress = await Promise.all(
      progressRecords.map((p) => Movie.findById(p.movieId))
    );

    continueWatching = progressRecords
      .map((p, i) => {
        const movie = moviesForProgress[i];
        if (!movie) return null;
        return {
          movie: toDto(movie),
          episodeNumber: p.episodeNumber,
          lastPosition: p.lastPosition,
        } as ContinueWatchingDto;
      })
      .filter((x): x is ContinueWatchingDto => x !== null);
  }

  return { featured: featured ? toDto(featured) : null, continueWatching, sections };
}

export async function listMovies(): Promise<MovieDto[]> {
  const movies = await Movie.find({ status: "written" }).sort({ createdAt: -1 });
  return movies.map(toDto);
}

export async function getMovie(id: string): Promise<MovieDto | null> {
  const movie = await Movie.findById(id);
  return movie ? toDto(movie) : null;
}

export async function createMovie(dto: CreateMovieDto): Promise<MovieDto> {
  const movie = await Movie.create(dto);
  return toDto(movie);
}

export async function getMovieBlobName(
  movieId: string,
  episodeNumber?: number
): Promise<string | null> {
  const info = await getMovieBlobInfo(movieId, episodeNumber);
  return info?.blobName ?? null;
}

export async function getMovieBlobInfo(
  movieId: string,
  episodeNumber?: number
): Promise<{ blobName: string; previewDuration: number; totalDuration: number } | null> {
  const movie = await Movie.findById(movieId).select("+blobName +episodes.blobName");
  if (!movie) return null;

  if (movie.type === "series" && episodeNumber != null) {
    const ep = movie.episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!ep?.blobName) return null;
    return { blobName: ep.blobName, previewDuration: movie.previewDuration, totalDuration: ep.duration };
  }

  if (!movie.blobName) return null;
  return { blobName: movie.blobName, previewDuration: movie.previewDuration, totalDuration: movie.durationSeconds };
}

export async function upsertProgress(
  userAddress: string,
  movieId: string,
  episodeNumber: number,
  lastPosition: number
): Promise<void> {
  await Progress.updateOne(
    { userAddress: userAddress.toLowerCase(), movieId, episodeNumber },
    { $set: { lastPosition, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getProgress(
  userAddress: string,
  movieId: string,
  episodeNumber: number
): Promise<{ lastPosition: number } | null> {
  const p = await Progress.findOne({
    userAddress: userAddress.toLowerCase(),
    movieId,
    episodeNumber,
  }).lean();

  return p ? { lastPosition: p.lastPosition } : null;
}
