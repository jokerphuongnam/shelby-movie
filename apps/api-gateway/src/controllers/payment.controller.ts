import { Request, Response } from "express";
import * as paymentService from "../services/payment.service";
import type { VerifyPaymentDto } from "@shelby-movie/shared-types";

export async function verify(req: Request, res: Response) {
  const dto = req.body as VerifyPaymentDto;

  if (!dto.walletAddress || !dto.movieId || !dto.txHash) {
    return res.status(400).json({ error: "walletAddress, movieId, txHash are required" });
  }

  try {
    const result = await paymentService.verifyPayment(dto);
    res.json(result);
  } catch (err: any) {
    const status = err.message === "Movie not found" ? 404 : 402;
    res.status(status).json({ error: err.message });
  }
}
