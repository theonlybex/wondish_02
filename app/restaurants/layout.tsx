import { auth } from "@clerk/nextjs/server";
import { getAccount } from "@/lib/queries";
import { accountHasActivePremium } from "@/lib/auth";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Phase 2 web — /restaurants has to serve two audiences from ONE url, so it
// owns its chrome rather than living in a route group:
//
//   signed out — a diner who scanned a table QR and has no account (Phase 3
//     lands here). Gets the public Navbar/Footer shell.
//   signed in  — someone who clicked "Eat Out" in the dashboard sidebar. Keeps
//     the dashboard chrome; navigation must not vanish when you move between
//     sections of the same app.
//
// Deliberately NOT reusing (dashboard)/layout.tsx: that applies the onboarding
// gate and PremiumGuard, both of which would break the public case — this page
// must render for someone with no account at all.
const SURFACE = "#F8F7FA";

export default async function RestaurantsLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const account = userId ? await getAccount(userId) : null;

  // No account row is possible for a signed-in user (a stranded Clerk id), so
  // fall back to the public shell rather than rendering a broken header.
  if (!account) {
    return (
      <div className="bg-[#FFFDF5] text-[#1E1A1A]">
        <Navbar />
        {/* Horizontal padding lives here, not on the pages: the dashboard
            branch below gets it from main's p-5/p-8 instead. */}
        <main className="min-h-screen pt-24 pb-16 px-5 sm:px-8" style={{ background: SURFACE }}>
          {children}
        </main>
        <Footer />
      </div>
    );
  }

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isRestaurantStaff =
    account.roles?.some((r) => r.role.name === RESTAURANT_ADMIN_ROLE) ?? false;
  const isPremium = accountHasActivePremium(account.subscriptions ?? []);

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <div className="hidden lg:block">
        <DashboardSidebar isAdmin={isAdmin} isRestaurantStaff={isRestaurantStaff} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <DashboardHeader
          email={account.email ?? ""}
          name={`${account.firstName} ${account.lastName}`}
          plan={isAdmin ? "ADMIN" : isPremium ? "PREMIUM" : "FREE"}
        />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8" style={{ background: SURFACE }}>
          {children}
        </main>
      </div>
    </div>
  );
}
