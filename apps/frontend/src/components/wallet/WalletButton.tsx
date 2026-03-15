"use client";

import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";

const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

export function WalletButton() {
  const { connect, disconnect, account, connected } = useWallet();

  const balanceBadge = IS_ALPHA && (
    <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/25 tabular-nums">
      9,999 APT
    </span>
  );

  if (connected && account) {
    const short = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
    return (
      <div className="flex items-center gap-2">
        {balanceBadge}
        <button
          onClick={() => disconnect()}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition"
        >
          {short}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {balanceBadge}
      <button
        onClick={() => connect("Petra" as WalletName<"Petra">)}
        className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition"
      >
        Connect Petra
      </button>
    </div>
  );
}
