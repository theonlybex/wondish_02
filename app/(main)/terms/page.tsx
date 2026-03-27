import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Terms of Service" };

export default async function TermsPage() {
  const terms = await prisma.termsAndConditions.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl mx-auto px-5 py-16">
      <h1 className="text-3xl font-bold text-navy mb-2">Terms of Service</h1>
      {terms && (
        <p className="text-[#8A8D93] text-sm mb-8">Version {terms.version}</p>
      )}

      {terms ? (
        <div className="prose prose-sm max-w-none text-[#33303C] whitespace-pre-wrap">
          {terms.content}
        </div>
      ) : (
        <p className="text-[#8A8D93]">Terms of service will be published soon.</p>
      )}
    </div>
  );
}
