"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import type { MovieDto } from "@shelby-movie/shared-types";
import { getAlphaPurchased, saveAlphaPurchase } from "@/lib/alpha-data";
import { VideoPlayer } from "./VideoPlayer";
import { EpisodeSidebar } from "./EpisodeSidebar";

const aptosNodeUrl = process.env.NEXT_PUBLIC_APTOS_NODE_URL;
const aptos = new Aptos(
  aptosNodeUrl
    ? new AptosConfig({ fullnode: aptosNodeUrl })
    : new AptosConfig({ network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET })
);

const APT_RECIPIENT = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? "";
const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

interface MovieWatchProps {
  movie: MovieDto;
  alphaStreamToken?: string;
  initialEpisode?: number;
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function calcAlphaPreview(durationSeconds: number): number {
  if (durationSeconds < 300) return 30;
  return Math.min(Math.floor(durationSeconds * 0.1), 120);
}

export function MovieWatch({ movie, alphaStreamToken, initialEpisode = 1 }: MovieWatchProps) {
  // Derive these before hooks so they can be used in lazy state initializers
  const isFree = movie.accessType === "free";
  const isSeries = movie.type === "series" && movie.episodes.length > 0;

  const { account, signAndSubmitTransaction, signMessage, connected } = useWallet();

  // isPurchased: true for free movies always; for paid alpha movies, check sessionStorage
  const [isPurchased, setIsPurchased] = useState<boolean>(() => {
    if (!IS_ALPHA || isFree) return true;
    return getAlphaPurchased().includes(movie.id);
  });

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [directVideoUrl, setDirectVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState<"signing" | "confirming" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialPosition, setInitialPosition] = useState(0);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [episode, setEpisode] = useState(initialEpisode);
  const [showPaywall, setShowPaywall] = useState(false);
  const [purchaseToast, setPurchaseToast] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [bgPurchaseLoading, setBgPurchaseLoading] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowStickyBar(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const previewDuration = !isFree && !IS_ALPHA ? movie.previewDuration : undefined;
  const alphaPreviewLimit =
    IS_ALPHA && !isFree && !isPurchased && movie.durationSeconds
      ? calcAlphaPreview(movie.durationSeconds)
      : undefined;

  useEffect(() => {
    setEpisode(initialEpisode);
  }, [initialEpisode]);

  useEffect(() => {
    if (IS_ALPHA) {
      setInitialPosition(0);
      setProgressLoaded(true);
      return;
    }
    if (!movie.id || !account) {
      setInitialPosition(0);
      setProgressLoaded(true);
      return;
    }
    setProgressLoaded(false);
    fetch(`${API}/api/movies/progress?walletAddress=${account.address}&movieId=${movie.id}&episodeNumber=${episode}`)
      .then((r) => r.json())
      .then((d) => { setInitialPosition(d.lastPosition ?? 0); setProgressLoaded(true); })
      .catch(() => { setInitialPosition(0); setProgressLoaded(true); });
  }, [account, movie.id, episode]);

  useEffect(() => {
    setSessionToken(null);
    setDirectVideoUrl(null);
    setShowPaywall(false);
    setResumePosition(null);
    grantAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode]);

  useEffect(() => {
    if (!sessionToken || !progressLoaded) return;
    if (initialPosition <= 0) setResumePosition(0);
  }, [sessionToken, progressLoaded, initialPosition]);

  async function grantAccess() {
    if (IS_ALPHA && alphaStreamToken) {
      const alreadyPurchased = isFree || getAlphaPurchased().includes(movie.id);
      // Proxy URL — the real video URL never leaves the server
      setDirectVideoUrl(`/api/stream/${movie.id}?token=${alphaStreamToken}`);
      setSessionToken(alreadyPurchased ? (isFree ? "alpha-free" : "alpha-paid") : "alpha-preview");
      if (alreadyPurchased && !isFree) setIsPurchased(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const endpoint = isFree ? `${API}/api/access/free` : `${API}/api/access/preview`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account?.address ?? "", movieId: movie.id, episodeNumber: episode }),
      });
      if (!res.ok) throw new Error("Failed to get access");
      const { sessionToken: token, blobId } = await res.json();
      setSessionToken(token);
      if (blobId && (blobId.startsWith("https://") || blobId.startsWith("http://"))) {
        setDirectVideoUrl(blobId);
      }
    } catch (err: any) {
      setError(err.message ?? "Access failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAlphaPurchase() {
    if (signMessage) {
      try {
        await signMessage({
          message: `Purchasing access to "${movie.title}" — ${movie.priceAPT.toFixed(2)} APT`,
          nonce: Date.now().toString(),
        });
      } catch {
        // cancelled — still grant in demo mode
      }
    }

    await new Promise((r) => setTimeout(r, 2000));

    saveAlphaPurchase(movie.id);
    setIsPurchased(true);
    setSessionToken("alpha-paid");
    setPurchaseToast(true);
    setTimeout(() => setPurchaseToast(false), 4000);
  }

  async function handleBackgroundPurchase() {
    if (bgPurchaseLoading || isPurchased) return;
    setBgPurchaseLoading(true);
    try {
      await handleAlphaPurchase();
    } finally {
      setBgPurchaseLoading(false);
    }
  }

  async function handlePurchase() {
    if (!connected || !account) {
      setError("Connect your Petra wallet first");
      return;
    }
    setLoading(true);
    setTxStep("signing");
    setError(null);
    try {
      const priceOctas = Math.round(movie.priceAPT * 1e8);
      const response = await signAndSubmitTransaction({
        data: {
          function: "0x1::coin::transfer",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [APT_RECIPIENT, priceOctas],
        },
      });
      setTxStep("confirming");
      await aptos.waitForTransaction({ transactionHash: response.hash });
      setTxStep(null);
      const verifyRes = await fetch(`${API}/api/payment/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account.address, movieId: movie.id, txHash: response.hash, episodeNumber: episode }),
      });
      if (!verifyRes.ok) {
        const { error: msg } = await verifyRes.json();
        throw new Error(msg ?? "Payment verification failed");
      }
      const { sessionToken: token } = await verifyRes.json();
      setSessionToken(token);
      setShowPaywall(false);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
      setTxStep(null);
    }
  }

  function handlePreviewEnd() {
    setShowPaywall(true);
  }

  const currentEpisodeTitle = isSeries
    ? movie.episodes.find((e) => e.episodeNumber === episode)?.title
    : undefined;

  return (
    <div className="space-y-6">
      {purchaseToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5 px-5 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold shadow-2xl animate-toast-in whitespace-nowrap">
          <span>✓</span> Full version unlocked! Enjoy the rest of the film.
        </div>
      )}

      {/* Sticky purchase bar — appears on scroll */}
      {showStickyBar && IS_ALPHA && !isFree && !isPurchased && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-black/95 backdrop-blur-sm border-b border-white/10 px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-white font-semibold text-sm truncate">{movie.title}</p>
          <button
            onClick={handleBackgroundPurchase}
            disabled={bgPurchaseLoading}
            title="Unlock the full movie now to enjoy without interruptions."
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand text-white text-sm font-bold hover:bg-brand-dark transition-colors disabled:opacity-60 shrink-0"
          >
            {bgPurchaseLoading ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Unlocking…</>
            ) : (
              <><span>▶</span> Purchase — {movie.priceAPT.toFixed(2)} APT</>
            )}
          </button>
        </div>
      )}

      {/* Title row — purchase button lives here as the primary CTA */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white">{movie.title}</h1>
          {isSeries && (
            <p className="text-gray-400 text-sm mt-1">
              Season 1 · Episode {episode}
              {currentEpisodeTitle && ` — ${currentEpisodeTitle}`}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {movie.categories.map((c) => (
              <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{c}</span>
            ))}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isFree ? "bg-green-600/30 text-green-400" : "bg-brand/20 text-brand"}`}>
              {isFree ? "Free" : `${movie.priceAPT.toFixed(2)} APT`}
            </span>
            {IS_ALPHA && !isFree && isPurchased && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400 font-medium">✓ Owned</span>
            )}
          </div>
          <p className="text-gray-400 mt-3 text-sm leading-relaxed">{movie.description}</p>
        </div>

        {IS_ALPHA && !isFree && !isPurchased && (
          <div className="flex-shrink-0 flex flex-col items-end gap-2 pt-1">
            <button
              onClick={handleBackgroundPurchase}
              disabled={bgPurchaseLoading}
              title="Unlock the full movie now to enjoy without interruptions."
              className="flex items-center gap-2.5 px-6 py-3 rounded-lg bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors disabled:opacity-60 whitespace-nowrap shadow-lg shadow-brand/20"
            >
              {bgPurchaseLoading ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Unlocking…</>
              ) : (
                <><span>▶</span> Purchase Full Movie — {movie.priceAPT.toFixed(2)} APT</>
              )}
            </button>
            {alphaPreviewLimit && (
              <p className="text-xs text-amber-400/70">Free preview · first {alphaPreviewLimit}s</p>
            )}
            {IS_ALPHA && (
              <p className="text-[10px] text-gray-600">Simulated — no real APT required</p>
            )}
          </div>
        )}
      </div>

      <div className={`flex gap-6 ${isSeries && sessionToken ? "items-start" : ""}`}>
        <div className="flex-1 min-w-0">

          {loading && !sessionToken && !IS_ALPHA && (
            <div className="aspect-video rounded-xl bg-black/60 flex flex-col items-center justify-center gap-3">
              <div className="w-7 h-7 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
              <span className="text-gray-500 text-sm">Loading…</span>
            </div>
          )}

          {error && !sessionToken && !IS_ALPHA && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          {sessionToken && progressLoaded && resumePosition === null && initialPosition > 0 && (
            <div className="aspect-video rounded-xl bg-black/80 flex flex-col items-center justify-center gap-4">
              <p className="text-white font-medium">Continue from {formatSeconds(initialPosition)}?</p>
              <div className="flex gap-3">
                <button onClick={() => setResumePosition(initialPosition)} className="px-6 py-2.5 rounded bg-brand text-white text-sm font-bold hover:bg-brand-dark transition">
                  Resume
                </button>
                <button onClick={() => setResumePosition(0)} className="px-6 py-2.5 rounded bg-white/10 text-gray-300 text-sm hover:bg-white/20 transition">
                  Start Over
                </button>
              </div>
            </div>
          )}

          {sessionToken && resumePosition !== null && (
            <div className="relative">
              <VideoPlayer
                sessionToken={sessionToken}
                directUrl={directVideoUrl ?? undefined}
                initialPosition={resumePosition}
                movieId={movie.id}
                movieTitle={movie.title}
                episodeNumber={episode}
                creatorAddress={movie.creatorAddress}
                priceAPT={movie.priceAPT}
                previewDuration={previewDuration}
                onPreviewEnd={handlePreviewEnd}
                isPurchased={isPurchased}
                alphaPreviewLimit={alphaPreviewLimit}
                onPurchase={IS_ALPHA && !isFree ? handleAlphaPurchase : undefined}
                purchasePending={bgPurchaseLoading}
              />

              {showPaywall && !IS_ALPHA && (
                <div className="absolute inset-0 rounded-xl bg-black/90 flex flex-col items-center justify-center gap-4 z-20">
                  {txStep ? (
                    <>
                      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <p className="text-white text-sm">
                        {txStep === "signing" ? "Confirm in your Petra wallet…" : "Waiting for Aptos network confirmation…"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-white text-lg font-bold">Preview ended</p>
                      <p className="text-gray-400 text-sm">Unlock the full movie to keep watching</p>
                      {error && <p className="text-red-400 text-sm">{error}</p>}
                      <button onClick={handlePurchase} disabled={loading} className="flex items-center gap-2 px-8 py-3 rounded bg-brand text-white font-bold hover:bg-brand-dark transition disabled:opacity-50">
                        <span>▶</span> Unlock Movie — {movie.priceAPT.toFixed(2)} APT
                      </button>
                      {!connected && <p className="text-gray-500 text-xs">Connect your Petra wallet to purchase.</p>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {isSeries && sessionToken && resumePosition !== null && !showPaywall && (
          <EpisodeSidebar movieId={movie.id} episodes={movie.episodes} currentEpisode={episode} />
        )}
      </div>
    </div>
  );
}
