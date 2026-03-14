import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import type { MovieDto } from "@shelby-movie/shared-types";

export function MovieCard({ movie }: { movie: MovieDto }) {
  const isFree = movie.accessType === "free";

  return (
    <Link href={`/watch/${movie.id}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1a1a1a]">
        <Image
          src={movie.thumbnailUrl}
          alt={movie.title}
          fill
          className="object-cover transition duration-300 group-hover:scale-105 group-hover:brightness-75"
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/40 flex items-center justify-center">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
        </div>
        <div className="absolute top-2 right-2">
          {isFree ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-600/80 text-white font-semibold backdrop-blur-sm">
              FREE
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded bg-black/80 text-amber-400 font-semibold border border-amber-500/40 backdrop-blur-sm">
              {movie.priceAPT.toFixed(2)} APT
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1 px-0.5">
        <p className="text-sm font-medium text-white truncate">{movie.title}</p>
        <div className="flex gap-1 flex-wrap">
          {movie.categories.slice(0, 2).map((c) => (
            <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400">
              {c}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
