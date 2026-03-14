import Link from "next/link";
import { MovieUploadForm } from "@/components/upload/MovieUploadForm";
import { WalletButton } from "@/components/wallet/WalletButton";

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-cinema">
      <header className="flex items-center justify-between px-10 py-4 bg-black/60">
        <Link href="/" className="text-xl font-extrabold text-white">
          Shelby<span className="text-brand">Movie</span>
        </Link>
        <WalletButton />
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <MovieUploadForm />
      </main>
    </div>
  );
}
