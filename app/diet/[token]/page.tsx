import type { Metadata } from "next";
import { dietShareStore } from "@/lib/diet-share";
import { loadDietCard } from "@/lib/diet-card-db";
import { buildDietCard, type DietCard } from "@/lib/diet-card";
import type { FoodMapPatient } from "@/lib/food-map";

const SAMPLE_PERSON: FoodMapPatient = {
  mealType: { name: "Mediterranean" },
  foodAllergies: [
    { food: { name: "Peanuts", bannedIngredients: [{ name: "peanut butter" }, { name: "peanut oil" }, { name: "satay sauce" }] } },
    { food: { name: "Shellfish", bannedIngredients: [{ name: "shrimp" }, { name: "crab" }, { name: "lobster" }] } },
  ],
  foodToAvoid: [{ food: { name: "Mushrooms", bannedIngredients: [] } }, { food: { name: "Pork", bannedIngredients: [{ name: "bacon" }, { name: "ham" }] } }],
  foodPreferences: [],
  healthConditions: [{ condition: { name: "Hypertension", bannedIngredients: [{ name: "stock cubes" }] } }],
  motivations: [],
  ingredientPreferences: [{ liked: false, ingredient: { name: "Coriander" } }],
};

// The chef's page: one person's diet card, opened from a shared link with no
// account. It always shows today's rules. Never indexed, never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Diet card",
  description: "What to cook with, and what to leave out.",
  robots: { index: false, follow: false },
};

/** How many of an allergy's covered foods are listed before "and more". */
const INCLUDES_SHOWN = 10;

export default async function DietCardPage({ params }: { params: { token: string } }) {
  // /diet/sample outside production: a made-up person, to look at the page without a database.
  const sample = process.env.NODE_ENV !== "production" && params.token.startsWith("sample");
  const share = sample ? null : await dietShareStore.byToken(params.token);
  const card = sample
    ? buildDietCard("Mia", SAMPLE_PERSON, { showConditions: params.token === "sample-conditions", likes: ["Salmon", "Sweet potato", "Spinach"] })
    : share
      ? await loadDietCard(share.patientId, share.showConditions)
      : null;

  return (
    <main className="min-h-dvh bg-surface px-4 py-8 text-[#1E1A1A] print:bg-white print:py-0">
      <div className="mx-auto w-full max-w-xl">
        {card ? <Card card={card} /> : <Gone />}
        <p className="mt-6 text-center text-xs text-[#6A6565] print:mt-4">
          Made with Clara by Wondish. This page always shows the current list.
        </p>
      </div>
    </main>
  );
}

function Gone() {
  return (
    <section className="rounded-2xl border border-[#EAE4CA] bg-white p-6 text-center">
      <h1 className="text-xl font-extrabold">This link is no longer active</h1>
      <p className="mt-2 text-base leading-relaxed text-[#4F4A4A]">
        The person who shared it turned it off, or it has expired. Ask them to send you a new link from Clara.
      </p>
    </section>
  );
}

function Card({ card }: { card: DietCard }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[#EAE4CA] bg-white print:rounded-none print:border-0">
      <header className="bg-primary px-6 py-5 text-white print:bg-white print:px-0 print:text-[#1E1A1A]">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/85 print:text-[#6A6565]">Diet card</p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight">Cooking for {card.firstName}</h1>
        {card.eatingStyle.length > 0 && <p className="mt-1 text-base text-white/90 print:text-[#4F4A4A]">Eats: {card.eatingStyle.join(", ")}</p>}
      </header>

      <div className="space-y-6 px-6 py-6 print:px-0">
        {card.empty && (
          <p className="text-base leading-relaxed text-[#4F4A4A]">
            {card.firstName} has no food rules on file. Nothing to leave out.
          </p>
        )}

        {card.never.length > 0 && (
          <section aria-labelledby="never" className="rounded-xl border-2 border-[#B3261E] bg-[#FDF1F0] p-4">
            <h2 id="never" className="flex items-center gap-2 text-base font-extrabold text-[#8C1D18]">
              <WarningIcon />
              Never use: allergy
            </h2>
            <p className="mt-1 text-sm text-[#8C1D18]">Not even a small amount. Use clean boards, pans and oil.</p>
            <ul className="mt-3 space-y-2">
              {card.never.map((group) => (
                <li key={group.name} className="text-base leading-snug">
                  <span className="font-bold">{group.name}</span>
                  {group.includes.length > 0 && (
                    <span className="text-[#4F4A4A]">
                      {": "}
                      {group.includes.slice(0, INCLUDES_SHOWN).join(", ")}
                      {group.includes.length > INCLUDES_SHOWN ? ", and anything else made from it" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.avoid.length > 0 && (
          <Section id="avoid" title="Leave out">
            <ul className="flex flex-wrap gap-2">
              {card.avoid.map((name) => (
                <li key={name} className="rounded-full border border-[#D9D2B4] bg-[#F9F7ED] px-3 py-1 text-base">
                  {name}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {card.goEasy.length > 0 && (
          <Section id="easy" title="Go easy on">
            <ul className="space-y-2">
              {card.goEasy.map((line) => (
                <li key={line} className="text-base leading-relaxed text-[#1E1A1A]">
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {card.likes.length > 0 && (
          <Section id="likes" title="Likes">
            <p className="text-base leading-relaxed">{card.likes.join(", ")}</p>
          </Section>
        )}

        {card.conditions && card.conditions.length > 0 && (
          <Section id="conditions" title="Health conditions">
            <p className="text-base leading-relaxed">{card.conditions.join(", ")}</p>
            <p className="mt-1 text-sm text-[#6A6565]">Shared by {card.firstName} so you can cook with them in mind.</p>
          </Section>
        )}
      </div>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </svg>
  );
}
