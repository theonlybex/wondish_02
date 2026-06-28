import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import JournalCalendar from "@/components/journal/JournalCalendar";

export const metadata = { title: "Journal" };

export default async function JournalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");

  return (
    <div className="h-full overflow-auto">
      <style>{`
        @keyframes jn-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .jn { animation: jn-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="jn" style={{ animationDelay: "0ms" }}>
        <JournalCalendar />
      </div>
    </div>
  );
}
