"use client";

// Clerk handles session context via ClerkProvider in app/layout.tsx
// This component is kept for backwards compatibility but is a no-op
export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
