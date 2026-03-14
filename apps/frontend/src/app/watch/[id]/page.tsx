import { notFound } from "next/navigation";
import Link from "next/link";
import type { MovieDto } from "@shelby-movie/shared-types";
import { MovieWatch } from "@/components/movie/MovieWatch";
import { WalletButton } from "@/components/wallet/WalletButton";

export const dynamic = "force-dynamic";

async function fetchMovie(id: string): Promise<MovieDto | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/${id}`, {
      cache: "no-store",
    });
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
  const movie = await fetchMovie(params.id);
  if (!movie) return notFound();

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
        <MovieWatch movie={movie} initialEpisode={episode} />
      </main>
    </div>
  );
}
