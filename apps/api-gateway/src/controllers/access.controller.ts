import { Request, Response } from "express";
import { Access } from "../models/access.model";
import type { AccessDto, FreeAccessDto, PreviewAccessDto } from "@shelby-movie/shared-types";
import { grantFreeAccess, grantPreviewAccess } from "../services/payment.service";

export async function history(req: Request, res: Response) {
  const { walletAddress } = req.query;
  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress query param required" });
  }

  const records = await Access.find({ userAddress: walletAddress.toLowerCase() })
    .sort({ createdAt: -1 })
    .lean();

  const result: AccessDto[] = records.map((r) => ({
    id: String(r._id),
    movieId: String(r.movieId),
    txHash: r.txHash,
    lastWatched: r.lastWatched ? new Date(r.lastWatched).toISOString() : null,
    createdAt: new Date(r.createdAt as Date).toISOString(),
  }));

  res.json(result);
}

export async function markWatched(req: Request, res: Response) {
  const { walletAddress, movieId } = req.body;
  if (!walletAddress || !movieId) {
    return res.status(400).json({ error: "walletAddress and movieId required" });
  }

  await Access.updateOne(
    { userAddress: walletAddress.toLowerCase(), movieId },
    { $set: { lastWatched: new Date() } }
  );

  res.json({ ok: true });
}

export async function free(req: Request, res: Response) {
  const dto = req.body as FreeAccessDto;
  if (!dto.movieId) {
    return res.status(400).json({ error: "movieId required" });
  }

  try {
    const result = await grantFreeAccess(dto);
    res.json(result);
  } catch (err: any) {
    const status = err.message === "Movie not found" ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
}

export async function preview(req: Request, res: Response) {
  const dto = req.body as PreviewAccessDto;
  if (!dto.movieId) {
    return res.status(400).json({ error: "movieId required" });
  }

  try {
    const result = await grantPreviewAccess(dto);
    res.json(result);
  } catch (err: any) {
    const status = err.message === "Movie not found" ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
}
