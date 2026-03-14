"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const PROGRESS_SYNC_INTERVAL_MS = 30_000;
const CONFETTI_COLORS = ["#e50914", "#f5c518", "#00d9ff", "#ff6b6b", "#7fff00", "#ffd700"];

interface VideoPlayerProps {
  sessionToken: string;
  initialPosition?: number;
  movieId?: string;
  episodeNumber?: number;
  creatorAddress?: string;
  priceAPT?: number;
  previewDuration?: number;
  onPreviewEnd?: () => void;
}

const aptos = new Aptos(
  new AptosConfig({
    network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET,
  })
);

function Spinner() {
  return (
    <div className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: `${(i * 2.5 + (i % 7) * 3.1) % 100}%`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: `${(i * 0.06) % 1}s`,
        duration: `${2.2 + (i % 5) * 0.28}s`,
      })),
    []
  );

  return (
    <div aria-hidden>
      {pieces.map((p, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

export function VideoPlayer({
  sessionToken,
  initialPosition = 0,
  movieId,
  episodeNumber = 1,
  creatorAddress,
  priceAPT,
  previewDuration,
  onPreviewEnd,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSyncedPosition = useRef(0);
  const previewFired = useRef(false);
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const [showConfetti, setShowConfetti] = useState(false);
  // "signing" = waiting for Petra confirmation, "confirming" = waiting for Aptos finality
  const [donationStep, setDonationStep] = useState<"signing" | "confirming" | null>(null);

  const streamUrl = `${process.env.NEXT_PUBLIC_STREAM_URL}/stream/play?token=${sessionToken}`;

  // Seek to resume position once buffered
  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialPosition <= 0) return;

    const seek = () => { video.currentTime = initialPosition; };
    video.addEventListener("canplay", seek, { once: true });
    return () => video.removeEventListener("canplay", seek);
  }, [initialPosition]);

  // Client-side preview enforcement — pause and call onPreviewEnd when limit reached
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewDuration || !onPreviewEnd) return;

    previewFired.current = false;

    const handleTimeUpdate = () => {
      if (!previewFired.current && video.currentTime >= previewDuration) {
        previewFired.current = true;
        video.pause();
        onPreviewEnd();
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [previewDuration, onPreviewEnd]);

  // Task 1: 402 fallback — when the stream returns payment required the browser fires
  // a video error event. Call onPreviewEnd so the paywall modal appears even if the
  // client-side timeupdate check didn't trigger first (e.g. the user seeked ahead).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onPreviewEnd || previewDuration === undefined) return;

    const handleError = () => {
      if (previewFired.current) return;
      previewFired.current = true;
      video.pause();
      onPreviewEnd();
    };

    video.addEventListener("error", handleError);
    return () => video.removeEventListener("error", handleError);
  }, [previewDuration, onPreviewEnd]);

  // Sync playback position to api-gateway every 30s (Task 4 — already in place)
  const syncProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !movieId || !account) return;

    const position = Math.floor(video.currentTime);
    if (position === lastSyncedPosition.current || position === 0) return;

    lastSyncedPosition.current = position;

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: account.address,
        movieId,
        episodeNumber,
        lastPosition: position,
      }),
    }).catch(() => {});
  }, [account, movieId, episodeNumber]);

  useEffect(() => {
    const id = setInterval(syncProgress, PROGRESS_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [syncProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener("pause", syncProgress);
    window.addEventListener("beforeunload", syncProgress);
    return () => {
      video.removeEventListener("pause", syncProgress);
      window.removeEventListener("beforeunload", syncProgress);
    };
  }, [syncProgress]);

  // Task 2: donation with loading steps and confetti on success
  async function handleDonation() {
    if (!connected || !account || !creatorAddress || !priceAPT) return;
    try {
      setDonationStep("signing");
      const donationOctas = Math.round(priceAPT * 1e8);
      const response = await signAndSubmitTransaction({
        data: {
          function: "0x1::coin::transfer",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [creatorAddress, donationOctas],
        },
      });
      setDonationStep("confirming");
      await aptos.waitForTransaction({ transactionHash: response.hash });
      setDonationStep(null);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } catch {
      setDonationStep(null);
    }
  }

  return (
    <div className="space-y-3 w-full">
      {showConfetti && <Confetti />}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video w-full">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="w-full h-full"
          src={streamUrl}
        >
          Your browser does not support the video tag.
        </video>

        {/* Task 2: donation transaction loading overlay */}
        {donationStep && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
            <Spinner />
            <p className="text-white text-sm">
              {donationStep === "signing"
                ? "Confirm in your Petra wallet…"
                : "Waiting for Aptos network confirmation…"}
            </p>
          </div>
        )}
      </div>

      {creatorAddress && (
        <div className="flex items-center justify-end">
          <button
            onClick={handleDonation}
            disabled={!connected || donationStep !== null}
            title={!connected ? "Connect wallet to support" : undefined}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-white/10 text-sm text-gray-300 hover:bg-white/20 transition disabled:opacity-40"
          >
            ♥ Support Creator {priceAPT ? `(${priceAPT.toFixed(2)} APT)` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
