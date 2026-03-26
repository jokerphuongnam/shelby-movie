"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Film, Upload, CheckCircle } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { usePathname } from "next/navigation";
import { WalletButton } from "@/components/wallet/WalletButton";
import { UploadModal } from "@/components/upload/UploadModal";

const IS_ALPHA = process.env.NEXT_PUBLIC_ALPHA_TEST === "true";

export function NavHeader() {
  const { connected } = useWallet();
  const pathname = usePathname();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadToast, setUploadToast] = useState(false);

  useEffect(() => {
    // Clear alpha localStorage state when running in onchain (dev) mode
    if (!IS_ALPHA) {
      const ALPHA_KEYS = [
        "shelby_purchases",
        "alpha_watch_history",
        "shelby_anon_id",
        "shelby_anon_migrated",
      ];
      ALPHA_KEYS.forEach((k) => localStorage.removeItem(k));
    }
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("alpha_upload_toast")) {
      sessionStorage.removeItem("alpha_upload_toast");
      setUploadToast(true);
      setTimeout(() => setUploadToast(false), 4000);
    }
  }, [pathname]);

  return (
    <>
      {IS_ALPHA && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-black text-xs font-semibold text-center py-1.5 px-4 tracking-wide">
          ⚡ Alpha Test Mode — All transactions are simulated. No real APT required.
        </div>
      )}
      <header className={`fixed left-0 right-0 z-50 flex items-center justify-between px-10 py-4 bg-gradient-to-b from-black/85 to-transparent ${IS_ALPHA ? "top-7" : "top-0"}`}>
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
          {(connected || IS_ALPHA) && (
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

      {uploadToast && (
        <div className="fixed top-16 right-6 z-[200] flex items-center gap-2.5 px-4 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold shadow-2xl animate-toast-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          Movie published successfully!
        </div>
      )}
    </>
  );
}
