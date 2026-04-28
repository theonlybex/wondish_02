import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import OrdersTable from "@/components/orders/OrdersTable";

export const metadata = { title: "My Orders" };

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { patient: { account: { clerkId: userId } } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.order.count({ where: { patient: { account: { clerkId: userId } } } }),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">My Orders</h1>
        <p className="text-[#8A8D93] text-sm mt-1">Your order history</p>
      </div>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl">
        <OrdersTable
          initialOrders={orders as never}
          initialTotal={total as number}
        />
      </div>
    </div>
  );
}
