import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Onboarding gate — allow /profile itself to pass through
  // (checked in middleware-like fashion; profile page handles ?onboarding param)

  const isAdmin = session.user.roles?.includes("SUPER") ?? false;

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar — hidden on mobile, visible lg+ */}
      <div className="hidden lg:block">
        <DashboardSidebar isAdmin={isAdmin} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <DashboardHeader
          email={session.user.email}
          name={session.user.name}
          plan={session.user.plan}
        />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
