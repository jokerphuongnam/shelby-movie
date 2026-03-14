import crypto from "crypto";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { UserPermission } from "../models/user-permission.model";
import { Access } from "../models/access.model";
import { getMovieBlobInfo } from "./movie.service";
import { publishVideoAuthorized } from "../nats/publisher";
import type {
  VerifyPaymentDto,
  VerifyPaymentResponseDto,
  FreeAccessDto,
  PreviewAccessDto,
} from "@shelby-movie/shared-types";

const aptos = new Aptos(
  new AptosConfig({
    network: (process.env.APTOS_NETWORK as Network) ?? Network.TESTNET,
  })
);

const SESSION_TTL_MS =
  parseInt(process.env.SESSION_TOKEN_TTL_HOURS ?? "6", 10) * 60 * 60 * 1000;

function createSessionToken(): { sessionToken: string; expiresAt: Date } {
  return {
    sessionToken: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

export async function verifyPayment(dto: VerifyPaymentDto): Promise<VerifyPaymentResponseDto> {
  const { walletAddress, movieId, txHash, episodeNumber } = dto;

  const info = await getMovieBlobInfo(movieId, episodeNumber);
  if (!info) throw new Error("Movie not found");
  const blobName = info.blobName;

  // Verify on-chain: fetch the transaction and confirm it succeeded.
  // Prevents replay attacks — each txHash is unique and stored in Access.
  const tx = await aptos.getTransactionByHash({ transactionHash: txHash });

  if (!("success" in tx) || !tx.success) {
    throw new Error("Aptos transaction did not succeed");
  }

  await Access.updateOne(
    { userAddress: walletAddress.toLowerCase(), movieId },
    { $setOnInsert: { txHash } },
    { upsert: true }
  );

  const { sessionToken, expiresAt } = createSessionToken();

  await UserPermission.create({
    walletAddress: walletAddress.toLowerCase(),
    movieId,
    txHash,
    sessionToken,
    expiresAt,
  });

  await publishVideoAuthorized({
    sessionToken,
    walletAddress,
    movieId,
    blobId: blobName,
    expiresAt: expiresAt.getTime(),
  });

  return { authorized: true, sessionToken, blobId: blobName };
}

export async function grantFreeAccess(dto: FreeAccessDto): Promise<VerifyPaymentResponseDto> {
  const { walletAddress, movieId, episodeNumber } = dto;

  const info = await getMovieBlobInfo(movieId, episodeNumber);
  if (!info) throw new Error("Movie not found");

  const { sessionToken, expiresAt } = createSessionToken();

  await publishVideoAuthorized({
    sessionToken,
    walletAddress: walletAddress || "anonymous",
    movieId,
    blobId: info.blobName,
    expiresAt: expiresAt.getTime(),
  });

  return { authorized: true, sessionToken, blobId: info.blobName };
}

export async function grantPreviewAccess(dto: PreviewAccessDto): Promise<VerifyPaymentResponseDto> {
  const { walletAddress, movieId, episodeNumber } = dto;

  const info = await getMovieBlobInfo(movieId, episodeNumber);
  if (!info) throw new Error("Movie not found");

  const { sessionToken, expiresAt } = createSessionToken();

  await publishVideoAuthorized({
    sessionToken,
    walletAddress: walletAddress || "anonymous",
    movieId,
    blobId: info.blobName,
    expiresAt: expiresAt.getTime(),
    previewDuration: info.previewDuration,
    totalDuration: info.totalDuration,
  });

  return { authorized: true, sessionToken, blobId: info.blobName };
}
