import Link from "next/link";
import type { EpisodeDto } from "@shelby-movie/shared-types";

interface EpisodeSidebarProps {
  movieId: string;
  episodes: EpisodeDto[];
  currentEpisode: number;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EpisodeSidebar({ movieId, episodes, currentEpisode }: EpisodeSidebarProps) {
  return (
    <aside className="w-72 flex-none bg-black/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">Episodes</h3>
      </div>
      <ul className="overflow-y-auto max-h-[480px]">
        {episodes.map((ep) => {
          const isActive = ep.episodeNumber === currentEpisode;
          return (
            <li key={ep.episodeNumber}>
              <Link
                href={`/watch/${movieId}?episode=${ep.episodeNumber}`}
                className={`flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-white/10 ${
                  isActive ? "bg-brand/20 border-l-2 border-brand" : ""
                }`}
              >
                <span
                  className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold flex-none ${
                    isActive ? "bg-brand text-white" : "bg-white/10 text-gray-400"
                  }`}
                >
                  {ep.episodeNumber}
                </span>
                <div className="min-w-0">
                  <p className={`truncate ${isActive ? "text-white font-medium" : "text-gray-300"}`}>
                    {ep.title}
                  </p>
                  <p className="text-gray-600 text-xs">{formatDuration(ep.duration)}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
