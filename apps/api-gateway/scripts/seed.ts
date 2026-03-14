import mongoose from "mongoose";
import { Movie } from "../src/models/movie.model";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/shelbymovie";
const CREATOR = "0xseed000000000000000000000000000000000000000000000000000000000001";

const movies = [
  // ── Featured Movies ──────────────────────────────────────────────────────────
  {
    type: "movie",
    title: "Neon Horizon",
    description:
      "A rogue AI breaks free from its corporate chains and races across a neon-lit megacity to expose a conspiracy that could end human autonomy forever.",
    thumbnailUrl: "https://images.unsplash.com/photo-1535016120720-40c646be5580?w=600&q=80",
    blobName: "neon-horizon.mp4",
    categories: ["Sci-Fi", "Action"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: true,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 6840,
    previewDuration: 300,
  },
  {
    type: "movie",
    title: "Chain Breaker",
    description:
      "The first on-chain thriller: a whistleblower uploads evidence to an immutable ledger, triggering a global manhunt across three continents.",
    thumbnailUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&q=80",
    blobName: "chain-breaker.mp4",
    categories: ["Action", "Web3"],
    priceAPT: 2.5,
    accessType: "paid",
    isFeatured: true,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 7200,
    previewDuration: 300,
  },

  // ── Free Movies ───────────────────────────────────────────────────────────────
  {
    type: "movie",
    title: "The Last Block",
    description:
      "When the final Bitcoin is mined, a group of miners in rural Iceland uncover something buried beneath the protocol — something ancient.",
    thumbnailUrl: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=600&q=80",
    blobName: "the-last-block.mp4",
    categories: ["Drama", "Web3"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 5400,
    previewDuration: 0,
  },
  {
    type: "movie",
    title: "Aptos Rising",
    description:
      "A documentary tracing the founding of the Aptos network — from a garage in Palo Alto to a multi-billion dollar ecosystem.",
    thumbnailUrl: "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&q=80",
    blobName: "aptos-rising.mp4",
    categories: ["Web3", "Shelby Originals"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 4200,
    previewDuration: 0,
  },
  {
    type: "movie",
    title: "Silent Node",
    description:
      "An isolated network engineer discovers that every packet routed through her server is being watched. Silence is the only weapon left.",
    thumbnailUrl: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&q=80",
    blobName: "silent-node.mp4",
    categories: ["Sci-Fi", "Drama"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 5940,
    previewDuration: 0,
  },

  // ── Paid Movies ───────────────────────────────────────────────────────────────
  {
    type: "movie",
    title: "Velocity Protocol",
    description:
      "Two rival teams race to deploy the first zero-knowledge rollup on a hostile network while mercenaries close in from every direction.",
    thumbnailUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80",
    blobName: "velocity-protocol.mp4",
    categories: ["Action", "Sci-Fi", "Web3"],
    priceAPT: 1.5,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 6600,
    previewDuration: 300,
  },
  {
    type: "movie",
    title: "Fractured Signal",
    description:
      "A war photojournalist stumbles upon evidence of a deep-state surveillance grid hidden inside civilian satellites.",
    thumbnailUrl: "https://images.unsplash.com/photo-1516339901601-2e1b62dc0c45?w=600&q=80",
    blobName: "fractured-signal.mp4",
    categories: ["Drama", "Action"],
    priceAPT: 2.0,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 7560,
    previewDuration: 300,
  },

  // ── Series ────────────────────────────────────────────────────────────────────
  {
    type: "series",
    title: "Shelby Origins",
    description:
      "The origin story of the Shelby Protocol — told across five episodes from its whitepaper roots to mainnet launch.",
    thumbnailUrl: "https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=600&q=80",
    blobName: "",
    categories: ["Web3", "Shelby Originals"],
    priceAPT: 3.0,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 0,
    previewDuration: 180,
    episodes: [
      { episodeNumber: 1, title: "The Whitepaper", blobName: "shelby-origins-ep1.mp4", duration: 1800 },
      { episodeNumber: 2, title: "Testnet Wars",   blobName: "shelby-origins-ep2.mp4", duration: 2100 },
      { episodeNumber: 3, title: "The Audit",      blobName: "shelby-origins-ep3.mp4", duration: 1920 },
      { episodeNumber: 4, title: "Mainnet",        blobName: "shelby-origins-ep4.mp4", duration: 2400 },
      { episodeNumber: 5, title: "After the Storm",blobName: "shelby-origins-ep5.mp4", duration: 1680 },
    ],
  },
  {
    type: "series",
    title: "Dark Pool",
    description:
      "A financial crimes investigator follows a trail of wash trades and flash loans through the shadowy world of decentralised exchanges.",
    thumbnailUrl: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&q=80",
    blobName: "",
    categories: ["Drama", "Web3"],
    priceAPT: 2.5,
    accessType: "paid",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 0,
    previewDuration: 180,
    episodes: [
      { episodeNumber: 1, title: "Liquidity",        blobName: "dark-pool-ep1.mp4", duration: 2700 },
      { episodeNumber: 2, title: "Slippage",         blobName: "dark-pool-ep2.mp4", duration: 2520 },
      { episodeNumber: 3, title: "Front-Running",    blobName: "dark-pool-ep3.mp4", duration: 2880 },
      { episodeNumber: 4, title: "MEV",              blobName: "dark-pool-ep4.mp4", duration: 3000 },
    ],
  },
  {
    type: "series",
    title: "Zero Knowledge",
    description:
      "Three cryptographers, a journalist, and an ex-NSA analyst race to prove innocence using only math — without revealing a single private fact.",
    thumbnailUrl: "https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&q=80",
    blobName: "",
    categories: ["Sci-Fi", "Drama", "Shelby Originals"],
    priceAPT: 0,
    accessType: "free",
    isFeatured: false,
    status: "written",
    creatorAddress: CREATOR,
    durationSeconds: 0,
    previewDuration: 0,
    episodes: [
      { episodeNumber: 1, title: "The Proof",    blobName: "zk-ep1.mp4", duration: 2400 },
      { episodeNumber: 2, title: "The Witness",  blobName: "zk-ep2.mp4", duration: 2520 },
      { episodeNumber: 3, title: "The Circuit",  blobName: "zk-ep3.mp4", duration: 2280 },
    ],
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB:", MONGO_URI);

  const existing = await Movie.countDocuments();
  if (existing > 0) {
    console.log(`Database already has ${existing} movies. Drop the collection first to re-seed.`);
    console.log("  docker exec -it mongodb mongosh shelbymovie --eval 'db.movies.drop()'");
    await mongoose.disconnect();
    return;
  }

  await Movie.insertMany(movies);
  console.log(`Seeded ${movies.length} movies/series.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
