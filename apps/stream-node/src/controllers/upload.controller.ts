import { Request, Response } from "express";
import * as uploadService from "../services/upload.service";

export async function commitments(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: "video file required" });

  const result = await uploadService.generateCommitments(file.buffer);
  res.json(result);
}

export async function register(req: Request, res: Response) {
  const { txHash, uploadSessionId, walletAddress } = req.body as {
    txHash: string;
    uploadSessionId: string;
    walletAddress: string;
  };

  if (!txHash || !uploadSessionId || !walletAddress) {
    return res.status(400).json({ error: "txHash, uploadSessionId and walletAddress required" });
  }

  const result = await uploadService.confirmRegistration(txHash, uploadSessionId, walletAddress);
  res.json(result);
}

export async function chunk(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: "chunk file required" });

  const { uploadSessionId, blobId, chunkIndex, totalChunks } = req.body as {
    uploadSessionId: string;
    blobId: string;
    chunkIndex: string;
    totalChunks: string;
  };

  try {
    const result = await uploadService.receiveChunk(
      uploadSessionId,
      blobId,
      parseInt(chunkIndex, 10),
      parseInt(totalChunks, 10),
      file.buffer
    );
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
}
