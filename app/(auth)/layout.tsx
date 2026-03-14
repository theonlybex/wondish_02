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
        <Link href="/" className="inline-flex items-center gap-2 group">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/30">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z"
                fill="white"
              />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg">Wondish</span>
        </Link>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        {children}
      </div>
    </div>
  );
}
