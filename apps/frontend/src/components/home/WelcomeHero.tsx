"use client";

import Link from "next/link";
import { Upload, BookOpen, Tv } from "lucide-react";
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import { UploadModal } from "@/components/upload/UploadModal";

export function WelcomeHero() {
  const { connected, connect } = useWallet();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <div className="relative flex flex-col items-center justify-center min-h-[80vh] px-6 text-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(229,9,20,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(229,9,20,0.5) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="relative z-10 space-y-8 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-semibold tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            Powered by Shelby Protocol
          </div>

          <div className="flex justify-center">
            <Tv className="w-16 h-16 text-brand opacity-80" strokeWidth={1.5} />
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold text-white tracking-tight leading-none">
            Cinema on the{" "}
            <span className="text-brand">Blockchain</span>
          </h1>

          <p className="text-gray-400 text-lg leading-relaxed max-w-xl mx-auto">
            Join the decentralized cinema. Connect your wallet to contribute or browse the library.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            {connected ? (
              <button
                onClick={() => setUploadOpen(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-md bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload a Film
              </button>
            ) : (
              <button
                onClick={() => connect("Petra" as WalletName<"Petra">)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-md bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors"
              >
                Connect Wallet to Start
              </button>
            )}
            <Link
              href="/history"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-md bg-white/5 text-gray-300 font-semibold text-sm hover:bg-white/10 transition-colors border border-white/10"
            >
              <BookOpen className="w-4 h-4" />
              My Library
            </Link>
          </div>

          <p className="text-gray-600 text-xs pt-4">
            No subscription. Pay per view with APT. Creator-owned, decentralized.
          </p>
        </div>
      </div>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </>
  );
}
