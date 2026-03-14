import Image from "next/image";
import Link from "next/link";
import { Play, Info } from "lucide-react";
import type { MovieDto } from "@shelby-movie/shared-types";

export function HeroBanner({ movie }: { movie: MovieDto }) {
  const isFree = movie.accessType === "free";

  return (
    <div className="relative w-full h-[85vh] min-h-[580px] overflow-hidden">
      <Image
        src={movie.thumbnailUrl}
        alt={movie.title}
        fill
        priority
        className="object-cover scale-[1.02]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-black/10" />

      <div className="absolute bottom-24 left-10 right-[45%] space-y-5">
        <div className="flex gap-2 flex-wrap">
          {movie.categories.slice(0, 3).map((c) => (
            <span
              key={c}
              className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-gray-300 border border-white/10 backdrop-blur-sm"
            >
              {c}
            </span>
          ))}
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold text-white leading-none tracking-tight drop-shadow-2xl">
          {movie.title}
        </h1>

        <p className="text-gray-300 text-sm leading-relaxed max-w-lg line-clamp-3">
          {movie.description}
        </p>

        <div className="flex items-center gap-3 pt-1">
          <Link
            href={`/watch/${movie.id}`}
            className="flex items-center gap-2 px-7 py-3 rounded-md bg-white text-black font-bold text-sm hover:bg-gray-100 transition-colors"
          >
            <Play className="w-4 h-4 fill-black" />
            Watch Now
          </Link>
          <Link
            href={`/watch/${movie.id}`}
            className="flex items-center gap-2 px-7 py-3 rounded-md bg-white/10 text-white font-semibold text-sm hover:bg-white/20 transition-colors backdrop-blur-sm border border-white/10"
          >
            <Info className="w-4 h-4" />
            More Info
          </Link>
          <span className={`ml-1 text-sm font-bold ${isFree ? "text-green-400" : "text-amber-400"}`}>
            {isFree ? "FREE" : `${movie.priceAPT.toFixed(2)} APT`}
          </span>
        </div>
      </div>
    </div>
  );
}
