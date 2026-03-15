import { Router, Request, Response } from "express";
import { Movie } from "../models/movie.model";

const router = Router();

const BASE_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/";

export const SEED_MOVIES = [
  {
    type: "movie",
    title: "Quantum Shadows",
    description:
      "In 2089, a rogue AI escapes its quantum containment and begins rewriting human memory. One detective with a shattered neural implant stands between digital oblivion and the last free city on Earth.",
    thumbnailUrl: "https://images.unsplash.com/photo-1535223289429-462ea9301402?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}BigBuckBunny.mp4`,
    categories: ["Sci-Fi", "Thriller"],
    priceAPT: 1.5,
    accessType: "paid",
    isFeatured: true,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 596,
    previewDuration: 90,
    episodes: [],
  },
  {
    type: "movie",
    title: "The Forgotten Protocol",
    description:
      "Deep inside an abandoned research facility, two engineers uncover a living machine that has been making decisions for humanity since 1972. Some questions were never meant to be answered.",
    thumbnailUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}ElephantsDream.mp4`,
    categories: ["Sci-Fi", "Drama"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 654,
    previewDuration: 0,
    episodes: [],
  },
  {
    type: "movie",
    title: "Neon Requiem",
    description:
      "A street-level jazz musician in rain-soaked Neo-Tokyo discovers that every melody he composes is being harvested by a corporate algorithm to synthesize perfect addiction. His final concert will be his last act of rebellion.",
    thumbnailUrl: "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}TearsOfSteel.mp4`,
    categories: ["Drama", "Sci-Fi"],
    priceAPT: 2.0,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 734,
    previewDuration: 120,
    episodes: [],
  },
  {
    type: "movie",
    title: "Cyber Drift",
    description:
      "When the world's fastest illegal street racer is framed for a corporate assassination, she has 48 hours to outrun both law enforcement and the syndicate before her neural license expires permanently.",
    thumbnailUrl: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}ForBiggerEscapes.mp4`,
    categories: ["Action", "Thriller"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 15,
    previewDuration: 0,
    episodes: [],
  },
  {
    type: "movie",
    title: "Last Signal",
    description:
      "A deep-space communications officer receives a transmission from a colony ship that vanished forty years ago. What she hears forces her to question whether humanity was ever truly alone — or ever truly safe.",
    thumbnailUrl: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}VolkswagenGTIReview.mp4`,
    categories: ["Sci-Fi", "Drama"],
    priceAPT: 0.8,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 112,
    previewDuration: 30,
    episodes: [],
  },
  {
    type: "movie",
    title: "Desert Protocol",
    description:
      "Stranded in the Atacama Desert after their convoy is ambushed, a team of field scientists must activate a classified terraforming device before a hostile military force reaches their position at dawn.",
    thumbnailUrl: "https://images.unsplash.com/photo-1508193638397-1c4234db14d8?w=400&h=600&fit=crop&q=80",
    blobName: `${BASE_VIDEO}SubaruOutbackOnStreetAndDirt.mp4`,
    categories: ["Action", "Documentary"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 60,
    previewDuration: 0,
    episodes: [],
  },
];

export async function seedIfEmpty(): Promise<void> {
  const count = await Movie.countDocuments();
  if (count > 0) return;
  await Movie.insertMany(SEED_MOVIES);
  console.log(`[seed] Inserted ${SEED_MOVIES.length} alpha movies`);
}

router.post("/seed", async (_req: Request, res: Response) => {
  const count = await Movie.countDocuments();
  if (count > 0) {
    return res.json({ seeded: false, message: `${count} movies already exist — skipped` });
  }
  await Movie.insertMany(SEED_MOVIES);
  res.json({ seeded: true, count: SEED_MOVIES.length });
});

export default router;
