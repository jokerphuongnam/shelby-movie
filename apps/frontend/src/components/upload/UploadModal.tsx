"use client";

import { useEffect } from "react";
import { MovieUploadForm } from "./MovieUploadForm";

export function UploadModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/80 backdrop-blur-sm px-4 py-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl bg-[#1a1a1a] rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Creator Studio</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors text-lg"
          >
            ✕
          </button>
        </div>
        <div className="px-8 py-6">
          <MovieUploadForm />
        </div>
      </div>
    </div>
  );
}
