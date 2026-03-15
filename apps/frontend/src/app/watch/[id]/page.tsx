import { notFound } from "next/navigation";
import Link from "next/link";
import type { MovieDto } from "@shelby-movie/shared-types";
import { ALPHA_MOVIES } from "@/lib/alpha-data";
import { MovieWatch } from "@/components/movie/MovieWatch";
import { WalletButton } from "@/components/wallet/WalletButton";

export const dynamic = "force-dynamic";

const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";
const SERVER_API = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchMovie(id: string): Promise<MovieDto | null> {
  try {
    const res = await fetch(`${SERVER_API}/api/movies/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface WatchPageProps {
  params: { id: string };
  searchParams: { episode?: string };
}

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  let movie: MovieDto | null;
  let alphaVideoUrl: string | undefined;

  if (IS_ALPHA) {
    const alphaMovie = ALPHA_MOVIES.find((m) => m.id === params.id);
    if (!alphaMovie) return notFound();
    const { videoUrl, ...dto } = alphaMovie;
    movie = dto;
    alphaVideoUrl = videoUrl;
  } else {
    movie = await fetchMovie(params.id);
    if (!movie) return notFound();
  }

  const episode = searchParams.episode ? parseInt(searchParams.episode, 10) : 1;

  return (
    <div className="min-h-screen bg-cinema">
      <header className="flex items-center justify-between px-10 py-4 bg-black/60">
        <Link href="/" className="text-xl font-extrabold text-white">
          Shelby<span className="text-brand">Movie</span>
        </Link>
        <WalletButton />
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <MovieWatch movie={movie} alphaVideoUrl={alphaVideoUrl} initialEpisode={episode} />
      </main>
    </div>
  );
}
