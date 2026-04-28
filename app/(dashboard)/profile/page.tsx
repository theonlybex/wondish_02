import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import ProfileForm from "@/components/profile/ProfileForm";

export const metadata = { title: "Profile" };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { onboarding?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const isOnboarding = searchParams.onboarding === "true";

  const [account, patient, refData] = await Promise.all([
    getAccount(userId),
    prisma.patient.findFirst({
      where: { account: { clerkId: userId } },
      include: {
        motivations: true,
        healthConditions: true,
        foodPreferences: true,
        foodToAvoid: true,
        foodAllergies: true,
      },
    }),
    Promise.all([
      prisma.gender.findMany({ orderBy: { name: "asc" } }),
      prisma.physicalActivity.findMany({ orderBy: { level: "asc" } }),
      prisma.motivation.findMany({ orderBy: { name: "asc" } }),
      prisma.healthCondition.findMany({ orderBy: { name: "asc" } }),
      prisma.foodPreference.findMany({ orderBy: { name: "asc" } }),
      prisma.foodToAvoid.findMany({ orderBy: { name: "asc" } }),
      prisma.foodAllergy.findMany({ orderBy: { name: "asc" } }),
    ]).then(
      ([genders, physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies]) => ({
        genders,
        physicalActivities,
        motivations,
        healthConditions,
        foodPreferences,
        foodToAvoid,
        foodAllergies,
      })
    ),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
          style={{ color: "#7DB87D" }}
        >
          {isOnboarding ? "Setup" : "Profile"}
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">
          {isOnboarding ? "Complete Your Profile" : "Profile"}
        </h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>
            {isOnboarding
              ? "Tell us about yourself so we can personalise your meal plan."
              : "Update your health profile and dietary preferences."}
          </p>
        </div>
      </div>

      <div className="ov" style={{ animationDelay: "80ms" }}>
        <ProfileForm
          initialData={patient as unknown as Record<string, unknown>}
          refData={refData}
          isOnboarding={isOnboarding}
          accountData={
            account
              ? { firstName: account.firstName, lastName: account.lastName, email: account.email }
              : { firstName: "", lastName: "", email: "" }
          }
        />
      </div>
    </div>
  );
}
