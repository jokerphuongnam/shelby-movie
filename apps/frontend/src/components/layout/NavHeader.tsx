"use client";

import { useState } from "react";
import Link from "next/link";
import { Film, Upload } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { UploadModal } from "@/components/upload/UploadModal";

export function NavHeader() {
  const { connected } = useWallet();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-10 py-4 bg-gradient-to-b from-black/85 to-transparent">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Film className="w-6 h-6 text-brand" strokeWidth={2.5} />
            <span className="text-white">SHELBY</span>
            <span className="text-brand">MOVIE</span>
          </Link>
          <nav className="hidden md:flex gap-6 text-sm text-gray-400">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/?filter=movie" className="hover:text-white transition-colors">Movies</Link>
            <Link href="/?filter=series" className="hover:text-white transition-colors">Series</Link>
            <Link href="/history" className="hover:text-white transition-colors">My Library</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {connected && (
            <button
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload
            </button>
          )}
          <WalletButton />
        </div>
      </header>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </>
  );
}
