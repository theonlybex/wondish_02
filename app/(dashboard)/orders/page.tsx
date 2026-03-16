import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import OrdersTable from "@/components/orders/OrdersTable";

export const metadata = { title: "My Orders" };

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
  });

  const [orders, total] = await (patient
    ? Promise.all([
        prisma.order.findMany({
          where: { patientId: patient.id },
          include: { items: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.order.count({ where: { patientId: patient.id } }),
      ])
    : Promise.resolve([[], 0]));

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
