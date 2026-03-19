import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { prisma } from "@/lib/db";
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

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = hasActivePremium(account?.subscription);

  // New-premium onboarding: redirect to Dish Tinder if premium user hasn't set up taste yet
  if (isPremium && !isAdmin && account) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const tasteSeen = (await cookies()).get("wondish_taste_seen")?.value === "1";
    if (pathname && pathname !== "/taste" && !tasteSeen) {
      const patient = await prisma.patient.findUnique({
        where: { accountId: account.id },
        select: { id: true },
      });
      if (patient) {
        const prefCount = await prisma.patientDishPreference.count({
          where: { patientId: patient.id },
        });
        if (prefCount === 0) redirect("/taste");
      }
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
          plan={isAdmin || isPremium ? "PREMIUM" : "FREE"}
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
