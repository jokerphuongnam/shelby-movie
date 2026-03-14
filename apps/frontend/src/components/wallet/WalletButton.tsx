"use client";

import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";

export function WalletButton() {
  const { connect, disconnect, account, connected } = useWallet();

  if (connected && account) {
    const short = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition"
      >
        {short}
      </button>
    );
  }

  return (
    <button
      onClick={() => connect("Petra" as WalletName<"Petra">)}
      className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition"
    >
      Connect Petra
    </button>
  );
}
