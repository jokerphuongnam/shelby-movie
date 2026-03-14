export interface EpisodeDto {
  episodeNumber: number;
  title: string;
  duration: number;
}

export interface MovieDto {
  id: string;
  type: "movie" | "series";
  title: string;
  description: string;
  thumbnailUrl: string;
  categories: string[];
  priceAPT: number;
  accessType: "free" | "paid";
  isFeatured: boolean;
  status: "pending" | "written";
  creatorAddress: string;
  episodes: EpisodeDto[];
  durationSeconds: number;
  previewDuration: number;
  createdAt: string;
}

export interface CreateMovieDto {
  type: "movie" | "series";
  title: string;
  description: string;
  thumbnailUrl: string;
  categories: string[];
  priceAPT: number;
  accessType?: "free" | "paid";
  isFeatured?: boolean;
  creatorAddress: string;
  durationSeconds?: number;
  previewDuration?: number;
  blobName?: string;
  episodes?: Array<{
    episodeNumber: number;
    title: string;
    blobName: string;
    duration: number;
  }>;
}

export interface HomeSection {
  title: string;
  movies: MovieDto[];
}

export interface ContinueWatchingDto {
  movie: MovieDto;
  episodeNumber: number;
  lastPosition: number;
}

export interface HomeDto {
  featured: MovieDto | null;
  continueWatching: ContinueWatchingDto[];
  sections: HomeSection[];
}
