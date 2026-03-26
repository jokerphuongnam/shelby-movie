"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

const ANON_KEY = "shelby_anon_id";
const MIGRATED_KEY = "shelby_anon_migrated";

export function useUserIdentity() {
  const { account, connected } = useWallet();
  const [anonymousId, setAnonymousId] = useState<string | null>(null);

  useEffect(() => {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      id = `guest_${hex}`;
      localStorage.setItem(ANON_KEY, id);
    }
    setAnonymousId(id);
  }, []);

  // Migrate anonymous progress records to wallet address on first connect
  useEffect(() => {
    if (!connected || !account || !anonymousId) return;
    const migrated = localStorage.getItem(MIGRATED_KEY);
    if (migrated === anonymousId) return;

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/movies/migrate-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonymousId, walletAddress: account.address }),
    })
      .then(() => localStorage.setItem(MIGRATED_KEY, anonymousId))
      .catch(() => {});
  }, [connected, account, anonymousId]);

  return {
    userId: (connected && account ? account.address : anonymousId) ?? "",
    isGuest: !connected,
    anonymousId,
  };
}
