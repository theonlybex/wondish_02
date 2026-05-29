import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Minimal header */}
      <header className="px-5 sm:px-8 py-5">
        <Link href="/" className="inline-flex items-center group">
          <span className="text-xl font-bold tracking-tight leading-none">
            <span className="text-white">won</span>
            <span className="text-primary">dish</span>
          </span>
        </Link>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        {children}
      </div>
    </div>
  );
}
