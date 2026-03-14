import { Schema, model, Document } from "mongoose";

export interface IEpisode {
  episodeNumber: number;
  title: string;
  blobName: string;
  duration: number;
}

export interface IMovie extends Document {
  type: "movie" | "series";
  title: string;
  description: string;
  thumbnailUrl: string;
  blobName: string;
  categories: string[];
  priceAPT: number;
  accessType: "free" | "paid";
  isFeatured: boolean;
  status: "pending" | "written";
  creatorAddress: string;
  episodes: IEpisode[];
  durationSeconds: number;
  previewDuration: number;
  createdAt: Date;
  updatedAt: Date;
}

const episodeSchema = new Schema<IEpisode>(
  {
    episodeNumber: { type: Number, required: true },
    title: { type: String, required: true },
    // Episode blob reference — excluded from public responses via service-layer projection
    blobName: { type: String, required: true },
    duration: { type: Number, required: true },
  },
  { _id: false }
);

const movieSchema = new Schema<IMovie>(
  {
    type: { type: String, enum: ["movie", "series"], default: "movie" },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    thumbnailUrl: { type: String, required: true },
    // Top-level blob reference for movies — never exposed in API responses
    blobName: { type: String, select: false, default: "" },
    categories: { type: [String], required: true, index: true },
    priceAPT: { type: Number, required: true, default: 0 },
    accessType: { type: String, enum: ["free", "paid"], default: "free" },
    isFeatured: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "written"], default: "pending" },
    creatorAddress: { type: String, required: true, lowercase: true },
    episodes: { type: [episodeSchema], default: [] },
    durationSeconds: { type: Number, default: 0 },
    previewDuration: { type: Number, default: 180 },
  },
  { timestamps: true }
);

movieSchema.index({ categories: 1, status: 1 });
movieSchema.index({ isFeatured: 1, status: 1 });
movieSchema.index({ createdAt: -1 });
movieSchema.index({ creatorAddress: 1 });

export const Movie = model<IMovie>("Movie", movieSchema);
