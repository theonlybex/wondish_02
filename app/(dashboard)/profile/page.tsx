import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import ProfileForm from "@/components/profile/ProfileForm";

export const metadata = { title: "My Profile" };

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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">
          {isOnboarding ? "Complete Your Profile" : "My Profile"}
        </h1>
        <p className="text-[#8A8D93] text-sm mt-1">
          {isOnboarding
            ? "Tell us about yourself so we can personalize your meal plan."
            : "Update your health profile and dietary preferences."}
        </p>
      </div>

      <ProfileForm
        initialData={patient as unknown as Record<string, unknown>}
        refData={refData}
        isOnboarding={isOnboarding}
        accountData={account ? { firstName: account.firstName, lastName: account.lastName, email: account.email } : { firstName: "", lastName: "", email: "" }}
      />

    </div>
  );
}
