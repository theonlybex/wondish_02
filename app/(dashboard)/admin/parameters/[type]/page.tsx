import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ParameterCrudTable from "@/components/admin/ParameterCrudTable";

const TYPE_LABELS: Record<string, string> = {
  gender: "Genders",
  "physical-activity": "Physical Activities",
  "meal-type": "Meal Types",
  "dish-type": "Dish Types",
  ethnic: "Ethnic Cuisines",
  motivation: "Motivations",
  "food-preference": "Food Preferences",
  "food-to-avoid": "Foods to Avoid",
  "food-allergy": "Food Allergies",
  "health-condition": "Health Conditions",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchItems(type: string): Promise<{ id: string; name: string }[]> {
  const map: Record<string, () => Promise<{ id: string; name: string }[]>> = {
    gender: () => prisma.gender.findMany({ orderBy: { name: "asc" } }),
    "physical-activity": () => prisma.physicalActivity.findMany({ orderBy: { name: "asc" } }),
    "meal-type": () => prisma.mealType.findMany({ orderBy: { name: "asc" } }),
    "dish-type": () => prisma.dishType.findMany({ orderBy: { name: "asc" } }),
    ethnic: () => prisma.ethnic.findMany({ orderBy: { name: "asc" } }),
    motivation: () => prisma.motivation.findMany({ orderBy: { name: "asc" } }),
    "food-preference": () => prisma.foodPreference.findMany({ orderBy: { name: "asc" } }),
    "food-to-avoid": () => prisma.foodToAvoid.findMany({ orderBy: { name: "asc" } }),
    "food-allergy": () => prisma.foodAllergy.findMany({ orderBy: { name: "asc" } }),
    "health-condition": () => prisma.healthCondition.findMany({ orderBy: { name: "asc" } }),
  };

  const fn = map[type];
  if (!fn) return [];
  return fn();
}

export async function generateMetadata({ params }: { params: { type: string } }) {
  return { title: TYPE_LABELS[params.type] ?? "Parameters" };
}

export default async function ParametersPage({
  params,
}: {
  params: { type: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!session.user.roles?.includes("SUPER")) redirect("/overview");

  const label = TYPE_LABELS[params.type];
  if (!label) notFound();

  const items = await fetchItems(params.type);

  const navTypes = Object.entries(TYPE_LABELS);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Parameters</h1>
        <p className="text-[#8A8D93] text-sm mt-1">Manage reference data tables</p>
      </div>

      {/* Type nav */}
      <div className="flex flex-wrap gap-2 mb-6">
        {navTypes.map(([t, l]) => (
          <a
            key={t}
            href={`/admin/parameters/${t}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              params.type === t
                ? "bg-primary text-white"
                : "bg-[#F3F2FF] text-[#8A8D93] hover:bg-primary/10 hover:text-primary"
            }`}
          >
            {l}
          </a>
        ))}
      </div>

      <div>
        <h2 className="text-base font-semibold text-navy mb-4">{label}</h2>
        <ParameterCrudTable type={params.type} initialItems={items} />
      </div>
    </div>
  );
}
