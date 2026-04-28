import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PremiumGuard from "@/components/PremiumGuard";

function hasActivePremium(subscription: { plan: string; status: string } | null | undefined): boolean {
  if (!subscription) return false;
  if (subscription.plan !== "PREMIUM") return false;
  return ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(subscription.status);
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await getAccount(userId);

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = hasActivePremium(account?.subscription);

  // New-premium onboarding: redirect to Dish Tinder only if user hasn't seen taste setup yet
  if (isPremium && !isAdmin && account) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && pathname !== "/taste") {
      const patient = await prisma.patient.findUnique({
        where: { accountId: account.id },
        select: { profileCompleted: true },
      });
      if (patient && !patient.profileCompleted) redirect("/taste");
    }
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <div className="hidden lg:block">
        <DashboardSidebar isAdmin={isAdmin} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <DashboardHeader
          email={account?.email ?? ""}
          name={account ? `${account.firstName} ${account.lastName}` : ""}
          plan={isAdmin ? "ADMIN" : isPremium ? "PREMIUM" : "FREE"}
        />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">
          <PremiumGuard isPremium={isPremium} isAdmin={isAdmin}>
            {children}
          </PremiumGuard>
        </main>
      </div>
    </div>
  );
}
