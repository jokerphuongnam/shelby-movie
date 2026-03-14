export interface VideoAuthorizedPayload {
  sessionToken: string;
  walletAddress: string;
  movieId: string;
  blobId: string;
  expiresAt: number;
  previewDuration?: number;
  totalDuration?: number;
}

export interface PreviewAccessDto {
  walletAddress?: string;
  movieId: string;
  episodeNumber?: number;
}

export interface VerifyPaymentDto {
  walletAddress: string;
  movieId: string;
  txHash: string;
  episodeNumber?: number;
}

export interface VerifyPaymentResponseDto {
  authorized: boolean;
  sessionToken: string;
  blobId: string;
}

export interface FreeAccessDto {
  walletAddress: string;
  movieId: string;
  episodeNumber?: number;
}

export interface ProgressUpdateDto {
  walletAddress: string;
  movieId: string;
  episodeNumber: number;
  lastPosition: number;
}

export interface ProgressDto {
  movieId: string;
  episodeNumber: number;
  lastPosition: number;
  updatedAt: string;
}

export interface AccessDto {
  id: string;
  movieId: string;
  txHash: string;
  lastWatched: string | null;
  createdAt: string;
}
