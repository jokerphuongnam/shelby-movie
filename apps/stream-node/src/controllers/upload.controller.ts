import { Request, Response } from "express";
import * as uploadService from "../services/upload.service";

export async function blobStatus(req: Request, res: Response) {
  const { blobId } = req.body as { blobId?: string };
  if (!blobId) return res.status(400).json({ error: "blobId required" });
  const exists = await uploadService.checkBlobExists(blobId);
  res.json({ exists });
}

export async function commitments(req: Request, res: Response) {
  const { fileId } = req.body as { fileId?: string };
  if (!fileId) {
    return res.status(400).json({ error: "fileId is required" });
  }
  try {
    const result = await uploadService.initUploadSession(String(fileId));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to init upload session" });
  }
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

  try {
    const result = await uploadService.confirmRegistration(txHash, uploadSessionId, walletAddress);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "Failed to confirm registration" });
  }
}

export async function chunk(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: "chunk file required" });

  const { uploadSessionId, chunkIndex, totalChunks } = req.body as {
    uploadSessionId: string;
    chunkIndex: string;
    totalChunks: string;
  };

  if (!uploadSessionId) return res.status(400).json({ error: "uploadSessionId required" });

  try {
    const result = await uploadService.receiveChunk(
      uploadSessionId,
      parseInt(chunkIndex, 10),
      parseInt(totalChunks, 10),
      file.buffer
    );
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
}
