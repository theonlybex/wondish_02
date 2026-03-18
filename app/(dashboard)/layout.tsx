import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PremiumGate from "@/components/PremiumGate";

function hasActivePremium(subscription: { plan: string; status: string } | null | undefined): boolean {
  if (!subscription) return false;
  if (subscription.plan !== "PREMIUM") return false;
  return ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(subscription.status);
}

// Routes free users can access normally (no gate)
const FREE_ROUTES = ["/profile"];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = hasActivePremium(account?.subscription);

  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const isFreeRoute = FREE_ROUTES.some((r) => pathname.startsWith(r));

  // Show premium gate instead of content on locked pages
  const showGate = !isAdmin && !isPremium && !isFreeRoute;

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <div className="hidden lg:block">
        <DashboardSidebar isAdmin={isAdmin} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <DashboardHeader
          email={account?.email ?? ""}
          name={account ? `${account.firstName} ${account.lastName}` : ""}
          plan={account?.subscription?.plan ?? "FREE"}
        />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">
          {showGate ? <PremiumGate /> : children}
        </main>
      </div>
    </div>
  );
}
