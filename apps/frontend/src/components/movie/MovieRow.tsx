import type { MovieDto } from "@shelby-movie/shared-types";
import { MovieCard } from "./MovieCard";

export function MovieRow({ title, movies }: { title: string; movies: MovieDto[] }) {
  if (movies.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white px-10 tracking-wide">{title}</h2>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-10 pb-3">
        {movies.map((movie) => (
          <div key={movie.id} className="snap-start flex-none w-40 sm:w-48">
            <MovieCard movie={movie} />
          </div>
        ))}
      </div>
    </section>
  );
}
