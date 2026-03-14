import { NavHeader } from "@/components/layout/NavHeader";
import { HeroBanner } from "@/components/movie/HeroBanner";
import { MovieRow } from "@/components/movie/MovieRow";
import { ContinueWatchingRow } from "@/components/movie/ContinueWatchingRow";
import { WelcomeHero } from "@/components/home/WelcomeHero";
import type { HomeDto } from "@shelby-movie/shared-types";

export const dynamic = "force-dynamic";

const EMPTY_HOME: HomeDto = { featured: null, continueWatching: [], sections: [] };

async function fetchHome(): Promise<HomeDto> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/home`, {
      cache: "no-store",
    });
    if (!res.ok) return EMPTY_HOME;
    return res.json();
  } catch {
    return EMPTY_HOME;
  }
}

export default async function HomePage() {
  const { featured, sections } = await fetchHome();
  const hasContent = featured || sections.some((s) => s.movies.length > 0);

  return (
    <div className="min-h-screen bg-[#050505]">
      <NavHeader />

      {featured ? (
        <HeroBanner movie={featured} />
      ) : (
        <div className="pt-20" />
      )}

      {hasContent ? (
        <div className="space-y-10 py-10">
          <ContinueWatchingRow />
          {sections.map((section) => (
            <MovieRow key={section.title} title={section.title} movies={section.movies} />
          ))}
        </div>
      ) : (
        <WelcomeHero />
      )}
    </div>
  );
}
