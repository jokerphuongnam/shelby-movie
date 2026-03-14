import { notFound } from "next/navigation";
import type { MovieDto } from "@shelby-movie/shared-types";
import { MovieWatch } from "@/components/movie/MovieWatch";

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

export default async function MoviePage({ params }: { params: { id: string } }) {
  const movie = await fetchMovie(params.id);
  if (!movie) return notFound();

  return (
    <main className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <MovieWatch movie={movie} />
    </main>
  );
}
