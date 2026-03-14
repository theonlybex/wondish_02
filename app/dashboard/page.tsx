import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { session_id?: string; welcome?: string };
}) {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch {
    redirect("/login");
  }
  if (!session) redirect("/login");

  const justUpgraded = !!searchParams.session_id;
  const welcome = !!searchParams.welcome;

  return (
    <div className="min-h-screen bg-[#F8F7FA]">
      {/* Nav */}
      <header className="bg-navy border-b border-white/[0.06] px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z" fill="white" />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg">Wondish</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-white/50 text-sm hidden sm:block">
            {session.user.email}
          </span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${session.user.plan === "PREMIUM" ? "bg-primary/20 text-primary" : "bg-white/10 text-white/50"}`}>
            {session.user.plan === "PREMIUM" ? "Premium" : "Free"}
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10">

        {/* Welcome / upgrade banners */}
        {justUpgraded && (
          <div className="bg-success/10 border border-success/20 text-success rounded-2xl px-6 py-4 mb-8 flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="font-medium text-sm">
              Payment confirmed — welcome to Premium! Your 14-day trial is active.
            </p>
          </div>
        )}

        {welcome && !justUpgraded && (
          <div className="bg-primary/10 border border-primary/20 text-primary rounded-2xl px-6 py-4 mb-8 flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
              <path d="M10 2l2 6h6l-5 3.5 2 6L10 14l-5 3.5 2-6L2 8h6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="font-medium text-sm">Welcome to Wondish! Your account is ready.</p>
          </div>
        )}

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#25293C]">
            Good to see you, {session.user.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-[#8A8D93] mt-1">Your nutrition dashboard is being set up.</p>
        </div>

        {/* Quick stats */}
        <div className="grid sm:grid-cols-3 gap-5 mb-8">
          {[
            { label: "Meal plan", value: "Not set up", icon: "📋", action: "Set up plan" },
            { label: "Today's calories", value: "— kcal", icon: "🔥", action: "Log meals" },
            { label: "Streak", value: "0 days", icon: "⚡", action: "Start tracking" },
          ].map(({ label, value, icon, action }) => (
            <div key={label} className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{icon}</span>
                <p className="text-[#8A8D93] text-sm font-medium">{label}</p>
              </div>
              <p className="text-[#25293C] font-bold text-xl mb-1">{value}</p>
              <p className="text-primary text-xs font-semibold cursor-pointer hover:underline">{action}</p>
            </div>
          ))}
        </div>

        {/* Upgrade CTA for free users */}
        {session.user.plan !== "PREMIUM" && (
          <div className="relative bg-navy rounded-2xl p-8 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <h2 className="text-white font-bold text-xl mb-2">
                Unlock the full Wondish experience
              </h2>
              <p className="text-white/50 text-sm mb-6 max-w-md">
                Upgrade to Premium for personalized meal planning, custom ingredients, and your full health journey dashboard. First 14 days free.
              </p>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-primary/30"
              >
                Upgrade to Premium — $15/mo
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
