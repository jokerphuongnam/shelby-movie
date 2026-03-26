"use client";

import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ReactNode, useEffect, useState } from "react";

export function WalletProvider({ children }: { children: ReactNode }) {
  // Delay autoConnect until after window.load so Petra's service worker is
  // fully injected before the adapter attempts connection. Without this delay,
  // every page load logs "Could not establish connection. Receiving end does not
  // exist" from Petra's content script.
  const [pageReady, setPageReady] = useState(false);

  useEffect(() => {
    if (document.readyState === "complete") {
      setPageReady(true);
    } else {
      const onLoad = () => setPageReady(true);
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return (
    <AptosWalletAdapterProvider
      autoConnect={pageReady}
      onError={(error) => {
        // Suppress the extension messaging race-condition noise that fires
        // before Petra's background worker is ready.
        if (
          typeof error?.message === "string" &&
          error.message.includes("Receiving end does not exist")
        ) return;
        console.error("Wallet error:", error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
