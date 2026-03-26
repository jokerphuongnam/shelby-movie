"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import type { MovieDto } from "@shelby-movie/shared-types";
import { getAlphaPurchased, saveAlphaPurchase, recordAlphaWatchHistory } from "@/lib/alpha-data";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { VideoPlayer } from "./VideoPlayer";
import { EpisodeSidebar } from "./EpisodeSidebar";
import { TransactionAudit } from "@/components/shared/TransactionAudit";

// MovieWatch only performs coin::transfer on Aptos Testnet — never needs the Shelby node.
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

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
  const { userId } = useUserIdentity();

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
  const [accountNotFound, setAccountNotFound] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<{
    loading: boolean;
    balanceOctas: number;
    gasUsed: number;
    gasUnitPrice: number;
  }>({ loading: false, balanceOctas: 0, gasUsed: 0, gasUnitPrice: 100 });
  const [maxGasAmount, setMaxGasAmount] = useState(20000);
  const [gasError, setGasError] = useState<{ haveAPT: number; needAPT: number } | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  // Global sticky alert — visible in the browser window even while Petra floats on top
  const [txGasAlert, setTxGasAlert] = useState<{ haveAPT: number; needAPT: number; shortfall: number } | null>(null);

  useEffect(() => {
    const onScroll = () => setShowStickyBar(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (showPaywall && connected && account && !IS_ALPHA) {
      fetchGasEstimate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPaywall, connected, account?.address]);

  // Record to localStorage after 30s of watching (alpha anonymous tracking)
  useEffect(() => {
    if (!IS_ALPHA || sessionToken === null || resumePosition === null) return;
    const timer = setTimeout(() => {
      recordAlphaWatchHistory(movie.id, movie.categories);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [sessionToken, resumePosition, movie.id, movie.categories]);

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
    setAccountNotFound(false);
    setGasError(null);
    setTxGasAlert(null);
    setError(null);
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
    setAccountNotFound(false);
    setTxGasAlert(null);

    const priceOctas = Math.round(movie.priceAPT * 1e8);

    // ── Step 1: verify account exists on-chain ────────────────────────────────
    try {
      await aptos.getAccountInfo({ accountAddress: account.address });
    } catch (preErr: any) {
      const preMsg = (preErr?.message ?? preErr?.toString() ?? "").toLowerCase();
      if (isAccountNotFoundMsg(preMsg)) {
        setAccountNotFound(true);
        setError("account_not_found");
        setLoading(false);
        setTxStep(null);
        return;
      }
      // Network hiccup — don't block, fall through
    }

    // ── Step 2: Inline simulation gate ───────────────────────────────────────
    // Runs BEFORE signAndSubmitTransaction — Petra must never open if gas is short.
    let resolvedMaxGas = maxGasAmount;
    let resolvedGasUnitPrice = Math.max(gasEstimate.gasUnitPrice, 150);
    let balanceForGate = 0;
    try {
      const [balanceOctas, simTx] = await Promise.all([
        aptos.getAccountAPTAmount({ accountAddress: account.address }),
        aptos.transaction.build.simple({
          sender: account.address,
          data: {
            function: "0x1::coin::transfer",
            typeArguments: ["0x1::aptos_coin::AptosCoin"],
            functionArguments: [APT_RECIPIENT, priceOctas],
          },
          options: { maxGasAmount: 200000 },
        }),
      ]);
      balanceForGate = balanceOctas;
      const [sim] = await aptos.transaction.simulate.simple({ transaction: simTx });
      const gasUsed = parseInt(sim.gas_used, 10);
      const gasUnitPrice = parseInt(sim.gas_unit_price, 10);
      // 20% safety buffer on top of simulated gas, floor at 30k
      const bufferedGas = Math.ceil(gasUsed * 1.2);
      const gasCostOctas = bufferedGas * gasUnitPrice;
      resolvedMaxGas = Math.max(bufferedGas, 50000);
      resolvedGasUnitPrice = Math.max(gasUnitPrice, 150);

      const vmStatus = (sim.vm_status ?? "").toLowerCase();
      const isGasFailure =
        !sim.success &&
        (vmStatus.includes("out_of_gas") ||
          vmStatus.includes("out of gas") ||
          vmStatus.includes("insufficient_balance_for_transaction_fee") ||
          vmStatus.includes("insufficient balance"));

      const totalRequired = priceOctas + gasCostOctas;
      if (isGasFailure || balanceOctas < totalRequired) {
        const haveAPT = balanceOctas / 1e8;
        const needAPT = totalRequired / 1e8;
        setTxGasAlert({ haveAPT, needAPT, shortfall: Math.max(needAPT - haveAPT, 0) });
        setGasError({ haveAPT, needAPT });
        setLoading(false);
        setTxStep(null);
        return;
      }
      setMaxGasAmount(resolvedMaxGas);
      setGasEstimate({ loading: false, balanceOctas, gasUsed, gasUnitPrice });
    } catch (simErr: any) {
      const simMsg = (simErr?.message ?? simErr?.toString() ?? "").toLowerCase();
      if (isAccountNotFoundMsg(simMsg)) {
        setAccountNotFound(true);
        setError("account_not_found");
        setLoading(false);
        setTxStep(null);
        return;
      }
      // Simulation threw due to gas / balance — block Petra
      if (
        simMsg.includes("out_of_gas") ||
        simMsg.includes("out of gas") ||
        simMsg.includes("insufficient_balance") ||
        simMsg.includes("insufficient balance") ||
        simMsg.includes("gas")
      ) {
        const haveAPT = balanceForGate / 1e8;
        const needAPT = movie.priceAPT + 0.005;
        setTxGasAlert({ haveAPT, needAPT, shortfall: Math.max(needAPT - haveAPT, 0) });
        setGasError({ haveAPT, needAPT });
        setLoading(false);
        setTxStep(null);
        return;
      }
      // Unrecognised network error — let Petra show it
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const response = await signAndSubmitTransaction({
        data: {
          function: "0x1::coin::transfer",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [APT_RECIPIENT, priceOctas],
        },
        options: {
          gasUnitPrice: resolvedGasUnitPrice,
          maxGasAmount: resolvedMaxGas,
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
      setTxGasAlert(null);
    } catch (err: any) {
      const msg = (err?.message ?? err?.toString() ?? "").toLowerCase();
      if (isAccountNotFoundMsg(msg)) {
        setAccountNotFound(true);
        setError("account_not_found");
      } else if (msg.includes("out_of_gas") || msg.includes("out of gas") || msg.includes("outofgas")) {
        const have = gasEstimate.balanceOctas > 0 ? gasEstimate.balanceOctas / 1e8 : 0;
        const gasCost = (gasEstimate.gasUsed * gasEstimate.gasUnitPrice) / 1e8;
        const haveAPT = have;
        const needAPT = movie.priceAPT + gasCost;
        setGasError({ haveAPT, needAPT });
        setTxGasAlert({ haveAPT, needAPT, shortfall: Math.max(needAPT - haveAPT, 0) });
        setError("out_of_gas");
      } else if (msg.includes("rejected") || msg.includes("user rejected") || msg.includes("cancelled")) {
        setError("Transaction cancelled.");
      } else {
        setError(err.message ?? "Transaction failed");
      }
    } finally {
      setLoading(false);
      setTxStep(null);
    }
  }

  function isAccountNotFoundMsg(msg: string) {
    return (
      msg.includes("account not found") ||
      msg.includes("account_not_found") ||
      msg.includes("no account exist") ||
      msg.includes("resource not found") ||
      msg.includes("account does not exist")
    );
  }

  function handlePreviewEnd() {
    setShowPaywall(true);
  }

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account.address).then(() => {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    });
  }

  async function fetchGasEstimate() {
    if (!account || IS_ALPHA) return;
    setGasEstimate({ loading: true, balanceOctas: 0, gasUsed: 0, gasUnitPrice: 100 });
    setGasError(null);

    // Step 1: verify account exists on-chain before any tx operations
    try {
      await aptos.getAccountInfo({ accountAddress: account.address });
    } catch (err: any) {
      const msg = (err?.message ?? err?.toString() ?? "").toLowerCase();
      if (isAccountNotFoundMsg(msg)) {
        setAccountNotFound(true);
        setGasEstimate({ loading: false, balanceOctas: 0, gasUsed: 0, gasUnitPrice: 100 });
        return;
      }
      // Network error — fall through and try the balance fetch anyway
    }

    try {
      const priceOctas = Math.round(movie.priceAPT * 1e8);
      const [balanceOctas, tx] = await Promise.all([
        aptos.getAccountAPTAmount({ accountAddress: account.address }).catch(() => 0),
        aptos.transaction.build.simple({
          sender: account.address,
          data: {
            function: "0x1::coin::transfer",
            typeArguments: ["0x1::aptos_coin::AptosCoin"],
            functionArguments: [APT_RECIPIENT, priceOctas],
          },
          options: { maxGasAmount: 200000 },
        }),
      ]);
      const [sim] = await aptos.transaction.simulate.simple({ transaction: tx });
      const gasUsed = parseInt(sim.gas_used, 10);
      const gasUnitPrice = parseInt(sim.gas_unit_price, 10);
      const bufferedGas = Math.ceil(gasUsed * 1.2);
      const gasCostOctas = bufferedGas * gasUnitPrice;
      setMaxGasAmount(Math.max(bufferedGas, 50000));
      setGasEstimate({ loading: false, balanceOctas, gasUsed, gasUnitPrice });

      if (!sim.success) {
        const status = (sim.vm_status ?? "").toLowerCase();
        if (
          status.includes("out_of_gas") ||
          status.includes("out of gas") ||
          status.includes("insufficient_balance_for_transaction_fee") ||
          status.includes("insufficient balance")
        ) {
          setGasError({ haveAPT: balanceOctas / 1e8, needAPT: (priceOctas + gasCostOctas) / 1e8 });
        }
      }
    } catch (err: any) {
      const msg = (err?.message ?? err?.toString() ?? "").toLowerCase();
      if (isAccountNotFoundMsg(msg)) {
        setAccountNotFound(true);
        setGasEstimate({ loading: false, balanceOctas: 0, gasUsed: 0, gasUnitPrice: 100 });
        return;
      }
      const balanceOctas = await aptos.getAccountAPTAmount({ accountAddress: account.address }).catch(() => 0);
      setGasEstimate({ loading: false, balanceOctas, gasUsed: 0, gasUnitPrice: 100 });
      if (msg.includes("out_of_gas") || msg.includes("out of gas") || msg.includes("outofgas")) {
        setGasError({ haveAPT: balanceOctas / 1e8, needAPT: movie.priceAPT + 0.005 });
      }
    }
  }

  const currentEpisodeTitle = isSeries
    ? movie.episodes.find((e) => e.episodeNumber === episode)?.title
    : undefined;

  return (
    <div className="space-y-6">

      {/* ── Global gas alert — fixed top, visible alongside Petra popup ─────── */}
      {txGasAlert && (
        <div className="fixed top-0 left-0 right-0 z-[300] bg-red-950 border-b border-red-500/40 px-6 py-4 flex items-start justify-between gap-4 shadow-2xl">
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-bold text-sm">Transaction Blocked: Insufficient Gas</p>
            <p className="text-gray-300 text-xs mt-1">
              You currently have{" "}
              <strong className="text-red-300 font-mono">{txGasAlert.haveAPT.toFixed(4)} APT</strong>.
              {" "}This transaction requires approximately{" "}
              <strong className="text-white font-mono">{txGasAlert.needAPT.toFixed(4)} APT</strong>{" "}
              to succeed. You are short by{" "}
              <strong className="text-red-300 font-mono">{txGasAlert.shortfall.toFixed(4)} APT</strong>.
            </p>
            <p className="text-gray-500 text-[11px] mt-1.5">
              Open Petra → <strong className="text-gray-400">Faucet</strong> → paste your address, then retry.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://aptoslabs.com/testnet-faucet"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded bg-green-600/30 border border-green-500/40 text-green-300 text-xs font-semibold hover:bg-green-600/50 transition whitespace-nowrap"
            >
              Get Gas
            </a>
            <button
              onClick={copyAddress}
              className="px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition whitespace-nowrap"
            >
              {copiedAddress ? "✓ Copied" : "Copy Address"}
            </button>
            <button
              onClick={() => setTxGasAlert(null)}
              className="px-3 py-1.5 rounded bg-white/10 text-gray-400 text-xs hover:bg-white/20 transition"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
                userId={userId || undefined}
                onPurchase={IS_ALPHA && !isFree ? handleAlphaPurchase : undefined}
                purchasePending={bgPurchaseLoading}
              />

              {showPaywall && !IS_ALPHA && (
                <div className="absolute inset-0 rounded-xl bg-black/90 flex flex-col items-center justify-center gap-4 z-20 px-8 text-center">
                  {txStep ? (
                    <>
                      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <p className="text-white text-sm font-medium">
                        {txStep === "signing" ? "Waiting for Aptos Testnet… Confirm in Petra" : "Confirming on Aptos Testnet…"}
                      </p>
                    </>
                  ) : accountNotFound ? (
                    <>
                      <div className="text-4xl">⚠️</div>
                      <p className="text-white text-lg font-bold">Account Not Active</p>
                      <p className="text-gray-400 text-sm max-w-sm text-center">
                        Your wallet address exists but isn&apos;t registered on Aptos Testnet yet. Please Faucet some APT and send a small test transaction to yourself to initialize it.
                      </p>
                      <div className="flex flex-col items-center gap-2 mt-1">
                        <p className="text-gray-500 text-xs">Open Petra → tap <strong className="text-gray-400">Faucet</strong> → send APT to yourself</p>
                        <p className="text-gray-600 text-[11px] font-mono break-all max-w-xs">{account?.address}</p>
                      </div>
                      <div className="flex gap-3 mt-2">
                        <button
                          onClick={copyAddress}
                          className="px-5 py-2.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-semibold hover:bg-amber-500/30 transition"
                        >
                          {copiedAddress ? "✓ Copied" : "Copy Address"}
                        </button>
                        <button
                          onClick={() => { setAccountNotFound(false); setError(null); handlePurchase(); }}
                          disabled={loading}
                          className="px-6 py-2.5 rounded bg-brand text-white text-sm font-bold hover:bg-brand-dark transition disabled:opacity-50"
                        >
                          Try Again
                        </button>
                        <button
                          onClick={() => { setAccountNotFound(false); setError(null); }}
                          className="px-5 py-2.5 rounded bg-white/10 text-gray-300 text-sm hover:bg-white/20 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (() => {
                    const priceOctas = Math.round(movie.priceAPT * 1e8);
                    const bufferedGasUsed = Math.ceil(gasEstimate.gasUsed * 1.2);
                    const gasCostOctas = bufferedGasUsed * gasEstimate.gasUnitPrice;
                    const totalOctas = priceOctas + gasCostOctas;
                    const balanceOctas = gasEstimate.balanceOctas;
                    const shortfallOctas = Math.max(totalOctas - balanceOctas, 0);
                    const insufficient = connected && !gasEstimate.loading && balanceOctas > 0 && balanceOctas < totalOctas;
                    const hasGasError = !!gasError;
                    const blockPurchase = loading || hasGasError || insufficient || gasEstimate.loading;
                    return (
                      <>
                        <p className="text-white text-lg font-bold">Preview ended</p>
                        <p className="text-gray-400 text-sm">Unlock the full movie to keep watching</p>

                        {connected && (
                          <div className="w-full max-w-xs">
                            <TransactionAudit
                              balanceAPT={balanceOctas / 1e8}
                              priceAPT={movie.priceAPT}
                              gasCostAPT={gasCostOctas / 1e8}
                              loading={gasEstimate.loading}
                              priceLabel="Movie price"
                              onRefreshBalance={() => fetchGasEstimate()}
                              onRefresh={() => { setGasError(null); fetchGasEstimate(); }}
                              onCopyAddress={copyAddress}
                              copiedAddress={copiedAddress}
                            />
                          </div>
                        )}

                        {error && error !== "out_of_gas" && error !== "account_not_found" && (
                          <p className="text-red-400 text-sm">{error}</p>
                        )}
                        <button
                          onClick={handlePurchase}
                          disabled={blockPurchase}
                          className="flex items-center gap-2 px-8 py-3 rounded bg-brand text-white font-bold hover:bg-brand-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>▶</span>}
                          {insufficient || hasGasError
                            ? "Insufficient APT"
                            : `Unlock Movie — ${movie.priceAPT.toFixed(2)} APT`}
                        </button>
                        {!connected && <p className="text-gray-500 text-xs">Connect your Petra wallet to purchase.</p>}
                      </>
                    );
                  })()}
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
