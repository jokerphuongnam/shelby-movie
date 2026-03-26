"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { TransactionAudit } from "@/components/shared/TransactionAudit";

const PROGRESS_SYNC_INTERVAL_MS = 30_000;
const CONFETTI_COLORS = ["#e50914", "#f5c518", "#00d9ff", "#ff6b6b", "#7fff00", "#ffd700"];
const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";
const DONATION_AMOUNTS = [0.5, 1.0, 2.0, 5.0];

interface VideoPlayerProps {
  sessionToken: string;
  directUrl?: string;
  initialPosition?: number;
  movieId?: string;
  movieTitle?: string;
  episodeNumber?: number;
  creatorAddress?: string;
  priceAPT?: number;
  // On-chain server-enforced preview
  previewDuration?: number;
  onPreviewEnd?: () => void;
  // Alpha client-side preview paywall
  isPurchased?: boolean;
  alphaPreviewLimit?: number;
  onPurchase?: () => Promise<void>;
  // Suppresses preview enforcement while a background purchase is in flight
  purchasePending?: boolean;
  // Overrides account.address for progress sync (supports anonymous users)
  userId?: string;
}

const aptos = new Aptos(
  new AptosConfig({
    network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET,
  })
);

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm"
    ? "w-5 h-5 border-2"
    : "w-7 h-7 border-2";
  return <div className={`${cls} border-white border-t-transparent rounded-full animate-spin`} />;
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
  directUrl,
  initialPosition = 0,
  movieId,
  movieTitle,
  episodeNumber = 1,
  creatorAddress,
  priceAPT,
  previewDuration,
  onPreviewEnd,
  isPurchased,
  alphaPreviewLimit,
  onPurchase,
  purchasePending,
  userId,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSyncedPosition = useRef(0);
  const previewFired = useRef(false);
  const pausedAtPreviewRef = useRef(false);
  const purchasePendingRef = useRef(purchasePending);
  const { account, signAndSubmitTransaction, signMessage, connected } = useWallet();

  const [showConfetti, setShowConfetti] = useState(false);
  const [donationStep, setDonationStep] = useState<"signing" | "confirming" | null>(null);
  const [alphaDonationToast, setAlphaDonationToast] = useState(false);
  const [showDonationPicker, setShowDonationPicker] = useState(false);
  const [selectedAmt, setSelectedAmt] = useState<number | null>(null);
  const [donationAudit, setDonationAudit] = useState<{
    loading: boolean; balanceAPT: number; gasCostAPT: number;
  }>({ loading: false, balanceAPT: 0, gasCostAPT: 0 });
  const [donationCopied, setDonationCopied] = useState(false);
  const [showPreviewPaywall, setShowPreviewPaywall] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);

  useEffect(() => { purchasePendingRef.current = purchasePending; }, [purchasePending]);

  const streamUrl = directUrl ?? `${process.env.NEXT_PUBLIC_STREAM_URL}/stream/play?token=${sessionToken}`;
  const isHls = streamUrl.includes(".m3u8");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => setVideoDuration(video.duration || 0);
    video.addEventListener("loadedmetadata", onMeta);
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHls) return;
    let hlsInstance: any;
    import("hls.js").then(({ default: Hls }) => {
      if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(video);
      } else {
        video.src = streamUrl;
      }
    });
    return () => hlsInstance?.destroy();
  }, [streamUrl, isHls]);

  // Seek to resume position once buffered
  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialPosition <= 0) return;

    const seek = () => { video.currentTime = initialPosition; };
    video.addEventListener("canplay", seek, { once: true });
    return () => video.removeEventListener("canplay", seek);
  }, [initialPosition]);

  // On-chain preview enforcement (server-backed, 402 path)
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

  // 402 fallback — video network error triggers paywall
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

  // Alpha client-side preview enforcement
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPurchased || !alphaPreviewLimit) return;

    let fired = false;

    const handleTimeUpdate = () => {
      if (fired || isPurchased || purchasePendingRef.current) return;
      if (video.currentTime >= alphaPreviewLimit) {
        fired = true;
        pausedAtPreviewRef.current = true;
        video.pause();
        setShowPreviewPaywall(true);
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [alphaPreviewLimit, isPurchased]);

  // Clamp seeking past preview limit when unpurchased
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPurchased || !alphaPreviewLimit) return;

    const handleSeeking = () => {
      if (video.currentTime > alphaPreviewLimit) {
        video.currentTime = Math.max(alphaPreviewLimit - 0.5, 0);
      }
    };

    video.addEventListener("seeking", handleSeeking);
    return () => video.removeEventListener("seeking", handleSeeking);
  }, [alphaPreviewLimit, isPurchased]);

  // Re-show overlay if user tries to play after preview ended without purchasing
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPurchased || !alphaPreviewLimit) return;

    const handlePlay = () => {
      if (pausedAtPreviewRef.current && !isPurchased) {
        video.pause();
        setShowPreviewPaywall(true);
      }
    };

    video.addEventListener("play", handlePlay);
    return () => video.removeEventListener("play", handlePlay);
  }, [alphaPreviewLimit, isPurchased]);

  // When isPurchased flips true — remove overlay and resume exactly where paused
  useEffect(() => {
    if (!isPurchased) return;
    setShowPreviewPaywall(false);
    if (pausedAtPreviewRef.current) {
      pausedAtPreviewRef.current = false;
      videoRef.current?.play().catch(() => {});
    }
  }, [isPurchased]);

  // Progress sync every 30 s
  const syncProgress = useCallback(() => {
    const video = videoRef.current;
    const effectiveUserId = userId ?? account?.address;
    if (!video || !movieId || !effectiveUserId) return;

    const position = Math.floor(video.currentTime);
    if (position === lastSyncedPosition.current || position === 0) return;

    lastSyncedPosition.current = position;

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: effectiveUserId,
        movieId,
        episodeNumber,
        lastPosition: position,
      }),
    }).catch(() => {});
  }, [account, movieId, episodeNumber, userId]);

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

  function openDonationPicker() {
    setShowDonationPicker(true);
    setSelectedAmt(null);
  }

  function closeDonationPicker() {
    setShowDonationPicker(false);
    setSelectedAmt(null);
    setDonationAudit({ loading: false, balanceAPT: 0, gasCostAPT: 0 });
  }

  async function selectDonationAmt(amt: number) {
    setSelectedAmt(amt);
    if (IS_ALPHA || !connected || !account || !creatorAddress) return;
    setDonationAudit({ loading: true, balanceAPT: 0, gasCostAPT: 0 });
    try {
      const donationOctas = Math.round(amt * 1e8);
      const [balanceOctas, tx] = await Promise.all([
        aptos.getAccountAPTAmount({ accountAddress: account.address }).catch(() => 0),
        aptos.transaction.build.simple({
          sender: account.address,
          data: {
            function: "0x1::coin::transfer",
            typeArguments: ["0x1::aptos_coin::AptosCoin"],
            functionArguments: [creatorAddress, donationOctas],
          },
          options: { maxGasAmount: 200000 },
        }),
      ]);
      const [sim] = await aptos.transaction.simulate.simple({ transaction: tx });
      const gasUsed = parseInt(sim.gas_used, 10);
      const gasUnitPrice = parseInt(sim.gas_unit_price, 10);
      const gasCostAPT = (Math.ceil(gasUsed * 1.2) * gasUnitPrice) / 1e8;
      setDonationAudit({ loading: false, balanceAPT: balanceOctas / 1e8, gasCostAPT });
    } catch {
      const balanceOctas = await aptos.getAccountAPTAmount({ accountAddress: account?.address ?? "" }).catch(() => 0);
      setDonationAudit({ loading: false, balanceAPT: balanceOctas / 1e8, gasCostAPT: 0.001 });
    }
  }

  function copyDonationAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account.address).then(() => {
      setDonationCopied(true);
      setTimeout(() => setDonationCopied(false), 2000);
    });
  }

  async function handlePurchaseClick() {
    if (!onPurchase || purchaseLoading) return;
    try {
      setPurchaseLoading(true);
      await onPurchase();
    } catch {
      // error handled in parent
    } finally {
      setPurchaseLoading(false);
    }
  }

  async function handleDonation(amount: number) {
    if (!creatorAddress) return;
    const label = movieTitle ?? movieId ?? "this movie";

    try {
      setDonationStep("signing");

      if (IS_ALPHA) {
        if (signMessage) {
          try {
            await signMessage({
              message: `Donating ${amount.toFixed(2)} APT to support "${label}"`,
              nonce: Date.now().toString(),
            });
          } catch {
            // cancelled — proceed in demo mode
          }
        }
        setDonationStep("confirming");
        await new Promise((r) => setTimeout(r, 1000));
        setDonationStep(null);
        closeDonationPicker();
        setAlphaDonationToast(true);
        setTimeout(() => setAlphaDonationToast(false), 4000);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        return;
      }

      const donationOctas = Math.round(amount * 1e8);
      // Gate: re-run simulation before opening Petra
      let resolvedMaxGas = 50000;
      let resolvedGasUnitPrice = 150;
      try {
        const [balanceOctas, simTx] = await Promise.all([
          aptos.getAccountAPTAmount({ accountAddress: account!.address }),
          aptos.transaction.build.simple({
            sender: account!.address,
            data: {
              function: "0x1::coin::transfer",
              typeArguments: ["0x1::aptos_coin::AptosCoin"],
              functionArguments: [creatorAddress, donationOctas],
            },
            options: { maxGasAmount: 200000 },
          }),
        ]);
        const [sim] = await aptos.transaction.simulate.simple({ transaction: simTx });
        const gasUsed = parseInt(sim.gas_used, 10);
        const gasUnitPrice = parseInt(sim.gas_unit_price, 10);
        const gasCostAPT = (Math.ceil(gasUsed * 1.2) * gasUnitPrice) / 1e8;
        resolvedMaxGas = Math.max(Math.ceil(gasUsed * 1.2), 50000);
        resolvedGasUnitPrice = Math.max(gasUnitPrice, 150);
        const totalOctas = donationOctas + Math.ceil(gasUsed * 1.2) * gasUnitPrice;
        if (!sim.success || balanceOctas < totalOctas) {
          setDonationAudit({ loading: false, balanceAPT: balanceOctas / 1e8, gasCostAPT });
          setDonationStep(null);
          return;
        }
        setDonationAudit({ loading: false, balanceAPT: balanceOctas / 1e8, gasCostAPT });
      } catch {
        // proceed — let Petra show error if something unexpected happens
      }
      const response = await signAndSubmitTransaction({
        data: {
          function: "0x1::coin::transfer",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [creatorAddress, donationOctas],
        },
        options: { gasUnitPrice: resolvedGasUnitPrice, maxGasAmount: resolvedMaxGas },
      });
      setDonationStep("confirming");
      await aptos.waitForTransaction({ transactionHash: response.hash });
      setDonationStep(null);
      closeDonationPicker();
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } catch {
      setDonationStep(null);
    }
  }

  return (
    <div className="space-y-3 w-full">
      {showConfetti && <Confetti />}

      {alphaDonationToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5 px-5 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold shadow-2xl animate-toast-in whitespace-nowrap">
          ♥ Thank you for supporting the creator!
        </div>
      )}

      <div className="relative rounded-xl overflow-hidden bg-black aspect-video w-full">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="w-full h-full"
          src={isHls ? undefined : streamUrl}
        >
          Your browser does not support the video tag.
        </video>

        {/* On-chain donation spinner overlay */}
        {donationStep && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 z-10">
            <Spinner />
            <p className="text-white text-sm">
              {donationStep === "signing"
                ? "Confirm in your Petra wallet…"
                : IS_ALPHA
                ? "Verifying donation on Alpha Node…"
                : "Waiting for Aptos network confirmation…"}
            </p>
          </div>
        )}

        {/* Alpha preview paywall overlay — shown when preview limit is reached */}
        {showPreviewPaywall && !isPurchased && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/88 backdrop-blur-[2px]">
            {purchaseLoading ? (
              <div className="flex flex-col items-center gap-3">
                <Spinner />
                <p className="text-white text-sm font-medium">Confirming purchase…</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 text-center px-8 max-w-sm">
                  <p className="text-2xl font-extrabold text-white leading-tight">
                    Enjoying{" "}
                    <span className="text-brand">
                      {movieTitle ?? "the movie"}
                    </span>
                    ?
                  </p>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    Purchase the full version to see what happens next.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-3 w-full px-8 max-w-xs">
                  <button
                    type="button"
                    onClick={handlePurchaseClick}
                    disabled={!onPurchase}
                    className="w-full flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-lg bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50"
                  >
                    <span>▶</span>
                    Purchase Full Movie
                    {priceAPT ? ` — ${priceAPT.toFixed(2)} APT` : ""}
                  </button>

                  {creatorAddress && (
                    <button
                      type="button"
                      onClick={() => { setShowPreviewPaywall(false); openDonationPicker(); }}
                      className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      ♥ Support creator instead
                    </button>
                  )}
                </div>

                {IS_ALPHA && (
                  <p className="text-xs text-gray-600">
                    Simulated purchase — no real APT required
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Preview progress indicator */}
      {alphaPreviewLimit && !isPurchased && videoDuration > 0 && (
        <div className="relative h-0.5 w-full rounded-full bg-white/10">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-amber-500/60"
            style={{ width: `${Math.min((alphaPreviewLimit / videoDuration) * 100, 100)}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-px h-3 -translate-x-1/2 bg-amber-400"
            style={{ left: `${Math.min((alphaPreviewLimit / videoDuration) * 100, 100)}%` }}
          />
          <span className="absolute right-0 top-1.5 text-[10px] text-gray-500 leading-none">
            Preview ends at {alphaPreviewLimit}s
          </span>
        </div>
      )}

      {/* Support Creator donation section */}
      {creatorAddress && (
        <div className="flex items-center justify-end">
          {showDonationPicker ? (
            <div className="flex flex-col items-end gap-2 w-full max-w-xs ml-auto">
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-xs text-gray-500 mr-1">Select amount:</span>
                {DONATION_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => selectDonationAmt(amt)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                      selectedAmt === amt
                        ? "bg-white text-black"
                        : "bg-white/10 text-gray-300 hover:bg-white/20"
                    }`}
                  >
                    {amt.toFixed(1)} APT
                  </button>
                ))}
                <button
                  type="button"
                  onClick={closeDonationPicker}
                  className="px-3 py-1.5 rounded text-gray-400 text-xs hover:bg-white/10 transition"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  Cancel
                </button>
              </div>

              {selectedAmt !== null && !IS_ALPHA && connected && (
                <div className="w-full">
                  <TransactionAudit
                    balanceAPT={donationAudit.balanceAPT}
                    priceAPT={selectedAmt}
                    gasCostAPT={donationAudit.gasCostAPT}
                    loading={donationAudit.loading}
                    priceLabel="Donation amount"
                    onRefreshBalance={() => selectDonationAmt(selectedAmt)}
                    onCopyAddress={copyDonationAddress}
                    copiedAddress={donationCopied}
                  />
                </div>
              )}

              {selectedAmt !== null && (
                <button
                  type="button"
                  onClick={() => selectedAmt && handleDonation(selectedAmt)}
                  disabled={
                    !selectedAmt ||
                    donationStep !== null ||
                    (!connected && !IS_ALPHA) ||
                    (!IS_ALPHA && !donationAudit.loading && donationAudit.balanceAPT > 0 &&
                      donationAudit.balanceAPT < selectedAmt + donationAudit.gasCostAPT)
                  }
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-brand text-white text-xs font-semibold hover:bg-brand-dark transition disabled:opacity-40"
                >
                  ♥ Donate {selectedAmt?.toFixed(1)} APT
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={openDonationPicker}
              disabled={donationStep !== null}
              title={!connected && !IS_ALPHA ? "Connect wallet to support" : undefined}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-white/10 text-sm text-gray-300 hover:bg-white/20 transition disabled:opacity-40"
            >
              ♥ Support Creator
            </button>
          )}
        </div>
      )}
    </div>
  );
}
