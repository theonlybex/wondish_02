import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import FeedbackForm from "@/components/feedback/FeedbackForm";

export const metadata = { title: "Feedback" };

// Users report bugs here; the triage bot files them for the team
// (spec docs/superpowers/specs/2026-10-07-feedback-reports-design.md).
export default async function FeedbackPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  return (
    <div className="max-w-2xl mx-auto pb-8">
      <h1 className="text-3xl font-bold text-[#1E1A1A]">Feedback</h1>
      <p className="text-sm mt-2 mb-6" style={{ color: "#6B6767" }}>
        Found something broken or wrong? Tell us — it goes straight to the team.
      </p>
      <FeedbackForm />
    </div>
  );
}
