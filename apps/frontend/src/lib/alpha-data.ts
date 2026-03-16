import type { MovieDto, HomeDto } from "@shelby-movie/shared-types";

const UNS = "https://images.unsplash.com/photo-";

// Stable pool of cinematic Unsplash thumbnails for alpha-uploaded movies
export const ALPHA_THUMBNAILS = [
  `${UNS}1536440136628-849c177e76a1?w=400&h=600&fit=crop&q=80`,
  `${UNS}1485846234645-a62644f84728?w=400&h=600&fit=crop&q=80`,
  `${UNS}1517604931442-7e0c8ed2963c?w=400&h=600&fit=crop&q=80`,
  `${UNS}1535223289429-462ea9301402?w=400&h=600&fit=crop&q=80`,
  `${UNS}1518709268805-4e9042af9f23?w=400&h=600&fit=crop&q=80`,
  `${UNS}1514320291840-2e0a9bf2a9ae?w=400&h=600&fit=crop&q=80`,
  `${UNS}1492144534655-ae79c964c9d7?w=400&h=600&fit=crop&q=80`,
  `${UNS}1446776811953-b23d57bd21aa?w=400&h=600&fit=crop&q=80`,
  `${UNS}1574375927938-d5a98e8ffe85?w=400&h=600&fit=crop&q=80`,
  `${UNS}1462331940025-496dfbfc7564?w=400&h=600&fit=crop&q=80`,
];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

export function getRandomAlphaThumbnail(seed?: string): string {
  const idx = seed
    ? stableHash(seed) % ALPHA_THUMBNAILS.length
    : Math.floor(Math.random() * ALPHA_THUMBNAILS.length);
  return ALPHA_THUMBNAILS[idx];
}

// Video URLs are intentionally absent — they live in alpha-data.server.ts only.
export const ALPHA_MOVIES: MovieDto[] = [
  {
    id: "alpha-0",
    type: "movie",
    title: "Quantum Shadows",
    description:
      "In 2089, a rogue AI escapes its quantum containment and begins rewriting human memory. One detective with a shattered neural implant stands between digital oblivion and the last free city on Earth.",
    thumbnailUrl: `${UNS}1535223289429-462ea9301402?w=400&h=600&fit=crop&q=80`,
    categories: ["Sci-Fi", "Thriller"],
    priceAPT: 1.5,
    accessType: "paid",
    isFeatured: true,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 596,
    previewDuration: 90,
    episodes: [],
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "alpha-1",
    type: "movie",
    title: "The Forgotten Protocol",
    description:
      "Deep inside an abandoned research facility, two engineers uncover a living machine that has been making decisions for humanity since 1972. Some questions were never meant to be answered.",
    thumbnailUrl: `${UNS}1518709268805-4e9042af9f23?w=400&h=600&fit=crop&q=80`,
    categories: ["Sci-Fi", "Drama"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 654,
    previewDuration: 0,
    episodes: [],
    createdAt: "2025-01-02T00:00:00.000Z",
  },
  {
    id: "alpha-2",
    type: "movie",
    title: "Neon Requiem",
    description:
      "A street-level jazz musician in rain-soaked Neo-Tokyo discovers that every melody he composes is being harvested by a corporate algorithm to synthesize perfect addiction. His final concert will be his last act of rebellion.",
    thumbnailUrl: `${UNS}1514320291840-2e0a9bf2a9ae?w=400&h=600&fit=crop&q=80`,
    categories: ["Drama", "Sci-Fi"],
    priceAPT: 2.0,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 734,
    previewDuration: 120,
    episodes: [],
    createdAt: "2025-01-03T00:00:00.000Z",
  },
  {
    id: "alpha-3",
    type: "movie",
    title: "Cyber Drift",
    description:
      "When the world's fastest illegal street racer is framed for a corporate assassination, she has 48 hours to outrun both law enforcement and the syndicate before her neural license expires permanently.",
    thumbnailUrl: `${UNS}1492144534655-ae79c964c9d7?w=400&h=600&fit=crop&q=80`,
    categories: ["Action", "Thriller"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 15,
    previewDuration: 0,
    episodes: [],
    createdAt: "2025-01-04T00:00:00.000Z",
  },
  {
    id: "alpha-4",
    type: "movie",
    title: "Last Signal",
    description:
      "A deep-space communications officer receives a transmission from a colony ship that vanished forty years ago. What she hears forces her to question whether humanity was ever truly alone — or ever truly safe.",
    thumbnailUrl: `${UNS}1446776811953-b23d57bd21aa?w=400&h=600&fit=crop&q=80`,
    categories: ["Sci-Fi", "Drama"],
    priceAPT: 0.8,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 112,
    previewDuration: 30,
    episodes: [],
    createdAt: "2025-01-05T00:00:00.000Z",
  },
  {
    id: "alpha-5",
    type: "movie",
    title: "Desert Protocol",
    description:
      "Stranded in the Atacama Desert after their convoy is ambushed, a team of field scientists must activate a classified terraforming device before a hostile military force reaches their position at dawn.",
    thumbnailUrl: `${UNS}1508193638397-1c4234db14d8?w=400&h=600&fit=crop&q=80`,
    categories: ["Action", "Documentary"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 60,
    previewDuration: 0,
    episodes: [],
    createdAt: "2025-01-06T00:00:00.000Z",
  },
  {
    id: "alpha-6",
    type: "movie",
    title: "Infernal Machine",
    description:
      "A retired demolitions expert is pulled back into the field when a prototype autonomous weapon — one she helped design — goes rogue and begins systematically eliminating its own creators.",
    thumbnailUrl: `${UNS}1574375927938-d5a98e8ffe85?w=400&h=600&fit=crop&q=80`,
    categories: ["Action", "Thriller"],
    priceAPT: 1.2,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 15,
    previewDuration: 8,
    episodes: [],
    createdAt: "2025-01-07T00:00:00.000Z",
  },
  {
    id: "alpha-7",
    type: "movie",
    title: "Parallel Drift",
    description:
      "A theoretical physicist accidentally opens a stable wormhole to a world where the Cold War never ended. She has six hours to close it before the military on both sides decides to use it as a weapon.",
    thumbnailUrl: `${UNS}1462331940025-496dfbfc7564?w=400&h=600&fit=crop&q=80`,
    categories: ["Sci-Fi", "Action"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: "alpha-tester",
    durationSeconds: 888,
    previewDuration: 0,
    episodes: [],
    createdAt: "2025-01-08T00:00:00.000Z",
  },
];

export function getAlphaPurchased(): string[] {
  try { return JSON.parse(sessionStorage.getItem("alpha_purchased") ?? "[]"); }
  catch { return []; }
}

export function saveAlphaPurchase(movieId: string): void {
  try {
    const ids = getAlphaPurchased();
    if (!ids.includes(movieId)) {
      sessionStorage.setItem("alpha_purchased", JSON.stringify([...ids, movieId]));
    }
  } catch { /* ignore */ }
}

export function getAlphaHomeData(): HomeDto {
  const featured = ALPHA_MOVIES[0];
  const free = ALPHA_MOVIES.filter((m) => m.accessType === "free");
  const paid = ALPHA_MOVIES.filter((m) => m.accessType === "paid");
  return {
    featured,
    continueWatching: [],
    sections: [
      { title: "Featured Films", movies: ALPHA_MOVIES.slice(0, 4) },
      { title: "Free to Watch", movies: free },
      { title: "Premium Films", movies: paid },
    ],
  };
}
