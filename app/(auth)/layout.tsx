import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Minimal header */}
      <header className="px-5 sm:px-8 py-5">
        <Link href="/" className="inline-flex items-center group text-white" aria-label="Wondish home">
          <BrandLogo className="h-5 w-auto" />
        </Link>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        {children}
      </div>
    </div>
  );
}
