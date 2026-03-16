import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

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
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
