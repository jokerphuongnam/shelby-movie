import { Schema, model, Document, Types } from "mongoose";

export interface IAccess extends Document {
  userAddress: string;
  movieId: Types.ObjectId;
  txHash: string;
  lastWatched: Date | null;
  createdAt: Date;
}

const accessSchema = new Schema<IAccess>(
  {
    userAddress: { type: String, required: true, lowercase: true },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true },
    txHash: { type: String, required: true, unique: true },
    lastWatched: { type: Date, default: null },
  },
  { timestamps: true }
);

accessSchema.index({ userAddress: 1, createdAt: -1 });
accessSchema.index({ userAddress: 1, movieId: 1 }, { unique: true });

export const Access = model<IAccess>("Access", accessSchema);
