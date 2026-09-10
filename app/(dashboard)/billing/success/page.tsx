import CheckoutSuccess from "@/components/billing/CheckoutSuccess";

export const metadata = { title: "Subscription confirmed" };

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  return <CheckoutSuccess sessionId={session_id ?? null} />;
}
