import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 text-center">
      <p className="text-7xl font-extrabold text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold text-forest-deeper">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-2 max-w-md text-sm text-forest/70">
        The page you&apos;re looking for may have moved or no longer exists.
      </p>
      <Link
        href="/"
        className="mt-8 bg-primary hover:bg-primary-dark text-forest-deeper px-6 py-2.5 rounded-full transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20"
      >
        Back to home
      </Link>
    </main>
  );
}
