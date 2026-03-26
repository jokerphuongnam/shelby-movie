"use client";

const FAUCET_URL = "https://aptoslabs.com/testnet-faucet";

interface TransactionAuditProps {
  balanceAPT: number;
  priceAPT: number;
  gasCostAPT: number;
  loading: boolean;
  priceLabel?: string;
  onRefreshBalance?: () => void;
  onRefresh?: () => void;
  onCopyAddress?: () => void;
  copiedAddress?: boolean;
  sUsdBalance?: number;
  sUsdStorageCost?: number;
}

export function TransactionAudit({
  balanceAPT,
  priceAPT,
  gasCostAPT,
  loading,
  priceLabel = "Price",
  onRefreshBalance,
  onRefresh,
  onCopyAddress,
  copiedAddress,
  sUsdBalance,
  sUsdStorageCost,
}: TransactionAuditProps) {
  const hasSUsd = sUsdStorageCost !== undefined && sUsdStorageCost > 0;
  const totalAPT = priceAPT + gasCostAPT;

  const insufficientAPT = !loading && balanceAPT > 0 && balanceAPT < totalAPT;
  const shortfallAPT = Math.max(totalAPT - balanceAPT, 0);

  const insufficientSUsd = hasSUsd && !loading && (sUsdBalance ?? 0) < sUsdStorageCost!;
  const shortfallSUsd = hasSUsd ? Math.max(sUsdStorageCost! - (sUsdBalance ?? 0), 0) : 0;

  const insufficient = insufficientAPT || insufficientSUsd;

  return (
    <div
      className="w-full rounded-xl border text-xs text-left overflow-hidden"
      style={{ borderColor: insufficient ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.1)" }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 border-b flex items-center gap-1.5"
        style={{
          borderColor: "inherit",
          background: insufficient ? "rgba(127,29,29,0.5)" : "rgba(255,255,255,0.04)",
        }}
      >
        <span className="text-base leading-none">⛽</span>
        <span className="text-gray-300 font-semibold text-[11px] uppercase tracking-wide">Transaction Preview</span>
        {loading && (
          <div className="ml-auto w-3 h-3 border border-gray-500 border-t-white/50 rounded-full animate-spin" />
        )}
      </div>

      {loading ? (
        <div className="px-3 py-3 text-gray-500">Fetching live balance and fee estimate…</div>
      ) : (
        <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.08)" }}>

          {/* ── Section 1: Network Fee (Gas) ───────────────────────────── */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">⚡ Network Fee (Gas)</span>
              {onRefreshBalance && (
                <button
                  onClick={onRefreshBalance}
                  title="Refresh balances"
                  className="ml-auto text-gray-600 hover:text-gray-300 transition text-sm leading-none"
                >
                  ↻
                </button>
              )}
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-400">Balance</span>
              <span className={`font-mono font-medium ${insufficientAPT ? "text-red-400" : "text-green-400"}`}>
                {balanceAPT.toFixed(4)} APT
              </span>
            </div>

            {priceAPT > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-gray-400">{priceLabel}</span>
                <span className="font-mono text-white">{priceAPT.toFixed(4)} APT</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-gray-400">Gas (Est)</span>
              <span className="font-mono text-amber-300">~{gasCostAPT.toFixed(4)} APT</span>
            </div>

            {priceAPT > 0 && (
              <div
                className="flex justify-between items-center border-t pt-1.5 font-semibold"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}
              >
                <span className="text-gray-300">Total Required</span>
                <span className={`font-mono ${insufficientAPT ? "text-red-400" : "text-green-400"}`}>
                  {totalAPT.toFixed(4)} APT
                </span>
              </div>
            )}

            {insufficientAPT && shortfallAPT > 0 && (
              <div className="pt-1 space-y-1.5">
                <p className="text-red-400 font-semibold text-[11px]">Insufficient APT for Gas</p>
                <p className="text-gray-500 text-[11px]">
                  Need <strong className="text-green-400 font-mono">{shortfallAPT.toFixed(4)} APT</strong> more to proceed.
                </p>
                <div className="flex gap-2">
                  <a
                    href={FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-2 py-1.5 rounded bg-green-600/25 border border-green-500/35 text-green-300 text-[11px] font-semibold text-center hover:bg-green-600/40 transition"
                  >
                    Get APT from Faucet
                  </a>
                  {onCopyAddress && (
                    <button
                      onClick={onCopyAddress}
                      className="px-2 py-1.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/30 transition whitespace-nowrap"
                    >
                      {copiedAddress ? "✓ Copied" : "Copy Address"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Section 2: Storage Cost (ShelbyUSD) ───────────────────── */}
          {hasSUsd && (
            <div className="px-3 py-2.5 space-y-1.5">
              <div className="mb-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">🗄️ Storage Cost (ShelbyUSD)</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-400">Balance</span>
                <span className={`font-mono font-medium ${insufficientSUsd ? "text-red-400" : "text-green-400"}`}>
                  {(sUsdBalance ?? 0).toFixed(6)} sUSD
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-400">Required</span>
                <span className="font-mono text-purple-300">~{sUsdStorageCost!.toFixed(6)} sUSD</span>
              </div>

              {insufficientSUsd && shortfallSUsd > 0 && (
                <div className="pt-1 space-y-1.5">
                  <p className="text-red-400 font-semibold text-[11px]">Insufficient ShelbyUSD for Storage</p>
                  <p className="text-gray-500 text-[11px]">
                    Need <strong className="text-purple-400 font-mono">{shortfallSUsd.toFixed(6)} sUSD</strong> more from the Shelby testnet faucet.
                  </p>
                  {onCopyAddress && (
                    <button
                      onClick={onCopyAddress}
                      className="px-2 py-1.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/30 transition"
                    >
                      {copiedAddress ? "✓ Copied" : "Copy Address"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Refresh estimate ──────────────────────────────────────── */}
          {onRefresh && (
            <div className="px-3 py-2">
              <button
                onClick={onRefresh}
                className="w-full px-2 py-1.5 rounded text-gray-400 text-[11px] hover:bg-white/10 transition"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                Refresh estimate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
