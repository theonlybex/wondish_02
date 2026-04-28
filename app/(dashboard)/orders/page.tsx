import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import OrdersTable from "@/components/orders/OrdersTable";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const where = { patient: { account: { clerkId: userId } } };

  const [orders, total, agg] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { totalAmount: true } }),
  ]);

  const rawSpent = agg._sum.totalAmount;
  const totalSpent = rawSpent != null ? parseFloat(rawSpent.toString()) : 0;

  return (
    <div className="max-w-4xl mx-auto">
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
          Orders
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">Orders</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>
            Your complete order history
          </p>
        </div>
      </div>

      <div
        className="ov bg-white rounded-2xl overflow-hidden"
        style={{
          animationDelay: "80ms",
          boxShadow:
            "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <OrdersTable
          initialOrders={orders as never}
          initialTotal={total}
          totalSpent={totalSpent}
        />
      </div>
    </div>
  );
}
