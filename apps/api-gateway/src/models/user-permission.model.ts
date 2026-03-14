import { Schema, model, Document, Types } from "mongoose";

export interface IUserPermission extends Document {
  walletAddress: string;
  movieId: Types.ObjectId;
  txHash: string;
  sessionToken: string;
  expiresAt: Date;
  createdAt: Date;
}

const userPermissionSchema = new Schema<IUserPermission>(
  {
    walletAddress: { type: String, required: true, lowercase: true },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true },
    txHash: { type: String, required: true, unique: true },
    sessionToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

userPermissionSchema.index({ walletAddress: 1, movieId: 1 });
userPermissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserPermission = model<IUserPermission>("UserPermission", userPermissionSchema);
