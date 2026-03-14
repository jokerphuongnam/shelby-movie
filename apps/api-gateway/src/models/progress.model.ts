import { Schema, model, Document, Types } from "mongoose";

export interface IProgress extends Document {
  userAddress: string;
  movieId: Types.ObjectId;
  episodeNumber: number;
  lastPosition: number;
  updatedAt: Date;
}

const progressSchema = new Schema<IProgress>(
  {
    userAddress: { type: String, required: true, lowercase: true },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true },
    episodeNumber: { type: Number, required: true, default: 1 },
    lastPosition: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

progressSchema.index({ userAddress: 1, movieId: 1, episodeNumber: 1 }, { unique: true });
progressSchema.index({ userAddress: 1, updatedAt: -1 });

export const Progress = model<IProgress>("Progress", progressSchema);
