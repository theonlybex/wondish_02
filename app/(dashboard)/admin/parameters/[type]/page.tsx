import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import ParameterCrudTable from "@/components/admin/ParameterCrudTable";

const TYPE_LABELS: Record<string, string> = {
  gender: "Genders",
  "physical-activity": "Physical Activities",
  "meal-type": "Meal Types",
  "dish-type": "Dish Types",
  ethnic: "Ethnic Cuisines",
  motivation: "Motivations",
  "food-preference": "Diets",
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
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account?.roles.some((r) => r.role.name === "SUPER")) redirect("/overview");

  const label = TYPE_LABELS[params.type];
  if (!label) notFound();

  const items = await fetchItems(params.type);
  const navTypes = Object.entries(TYPE_LABELS);

  return (
    <div className="max-w-3xl mx-auto">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* Header */}
      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
          style={{ color: "#7DB87D" }}
        >
          Admin · Parameters
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">{label}</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>
            {items.length} {items.length === 1 ? "entry" : "entries"} · Manage reference data tables
          </p>
        </div>
      </div>

      {/* Type nav */}
      <div className="ov flex flex-wrap gap-2 mb-6" style={{ animationDelay: "70ms" }}>
        {navTypes.map(([t, l]) => (
          <a
            key={t}
            href={`/admin/parameters/${t}`}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={
              params.type === t
                ? {
                    background: "#4ade80",
                    color: "#0a1509",
                    boxShadow: "0 2px 8px rgba(74,222,128,0.3)",
                  }
                : {
                    background: "#F0F4F0",
                    color: "#8A8D93",
                  }
            }
          >
            {l}
          </a>
        ))}
      </div>

      {/* CRUD table */}
      <div className="ov" style={{ animationDelay: "130ms" }}>
        <ParameterCrudTable type={params.type} initialItems={items} />
      </div>
    </div>
  );
}
