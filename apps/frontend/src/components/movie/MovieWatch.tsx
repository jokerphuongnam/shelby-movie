"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import type { MovieDto } from "@shelby-movie/shared-types";
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
  alphaVideoUrl?: string;
  initialEpisode?: number;
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function MovieWatch({ movie, alphaVideoUrl, initialEpisode = 1 }: MovieWatchProps) {
  const { account, signAndSubmitTransaction, signMessage, connected } = useWallet();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [directVideoUrl, setDirectVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState<"signing" | "confirming" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialPosition, setInitialPosition] = useState(0);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [episode, setEpisode] = useState(initialEpisode);
  const [showPaywall, setShowPaywall] = useState(false);
  const [alphaToast, setAlphaToast] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(null);

  const isFree = movie.accessType === "free";
  const isSeries = movie.type === "series" && movie.episodes.length > 0;
  const previewDuration = !isFree && !IS_ALPHA ? movie.previewDuration : undefined;

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
    // Alpha + direct URL: free movies auto-play; paid movies wait for user action
    if (IS_ALPHA && alphaVideoUrl) {
      if (isFree) {
        setDirectVideoUrl(alphaVideoUrl);
        setSessionToken("alpha-free");
      }
      // Paid movies: leave sessionToken null — alpha paywall gate renders
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const endpoint = (isFree || IS_ALPHA) ? `${API}/api/access/free` : `${API}/api/access/preview`;
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
    setLoading(true);
    setError(null);
    try {
      if (connected && account && signMessage) {
        setTxStep("signing");
        await signMessage({
          message: `Alpha Demo — Authorize access to "${movie.title}"`,
          nonce: Date.now().toString(),
        });
        setTxStep(null);
      }
      setDirectVideoUrl(alphaVideoUrl!);
      setSessionToken("alpha-paid");
      setAlphaToast(true);
      setTimeout(() => setAlphaToast(false), 4000);
    } catch (err: any) {
      setTxStep(null);
      // User cancelled Petra — still allow playback in demo mode
      if (err?.message?.toLowerCase().includes("cancel") || err?.message?.toLowerCase().includes("reject")) {
        setDirectVideoUrl(alphaVideoUrl!);
        setSessionToken("alpha-paid");
      } else {
        setError(err.message ?? "Signing failed");
      }
    } finally {
      setLoading(false);
      setTxStep(null);
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
      {alphaToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold shadow-2xl animate-fade-in">
          <span>✓</span> Alpha Mode: Transaction Bypassed Successfully
        </div>
      )}

      <div>
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
          {IS_ALPHA && !isFree && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">Demo</span>
          )}
        </div>
        <p className="text-gray-400 mt-3 text-sm leading-relaxed">{movie.description}</p>
      </div>

      <div className={`flex gap-6 ${isSeries && sessionToken ? "items-start" : ""}`}>
        <div className="flex-1 min-w-0">
          {/* Alpha paid gate — shown for paid movies in alpha before user signs */}
          {IS_ALPHA && !isFree && !sessionToken && (
            <div className="aspect-video rounded-xl bg-gradient-to-br from-black/80 to-black/60 border border-white/[0.08] flex flex-col items-center justify-center gap-5">
              <div className="space-y-1.5 text-center px-8">
                <p className="text-white font-bold text-xl">{movie.title}</p>
                <p className="text-gray-400 text-sm">
                  {movie.priceAPT.toFixed(2)} APT · Simulated transaction — no real APT required
                </p>
              </div>
              {txStep === "signing" ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-amber-400 text-sm font-medium">Confirm in your Petra wallet…</p>
                </div>
              ) : (
                <>
                  <button
                    onClick={handleAlphaPurchase}
                    disabled={loading}
                    className="flex items-center gap-2.5 px-8 py-3.5 rounded-lg bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50"
                  >
                    <span>▶</span> Watch Now — Demo
                  </button>
                  {!connected && (
                    <p className="text-gray-500 text-xs">Connect Petra to trigger a simulated signature</p>
                  )}
                  {error && <p className="text-red-400 text-xs">{error}</p>}
                </>
              )}
            </div>
          )}

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
                episodeNumber={episode}
                creatorAddress={movie.creatorAddress}
                priceAPT={movie.priceAPT}
                previewDuration={previewDuration}
                onPreviewEnd={handlePreviewEnd}
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
                        <span>▶</span> Unlock for {movie.priceAPT.toFixed(2)} APT
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
