"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const STATUS_OPTIONS = ["CONFIRMED", "PREPARING", "DELIVERED", "CANCELED"];
const statusVariant: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  PENDING: "neutral",
  CONFIRMED: "info",
  PREPARING: "warning",
  DELIVERED: "success",
  CANCELED: "error",
};

export default function ProviderOrdersPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provider/orders")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (orderId: string, status: string) => {
    setUpdatingId(orderId);
    try {
      await fetch("/api/provider/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status } : o))
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Orders</h1>
        <p className="text-[#8A8D93] text-sm mt-1">Manage user orders</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#8A8D93]">Loading…</div>
      ) : (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E7EA]">
                <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Date</th>
                <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">User</th>
                <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden md:table-cell">Items</th>
                <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Status</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const o = order as Record<string, unknown>;
                const patient = o.patient as Record<string, unknown>;
                const account = patient?.account as Record<string, unknown>;
                return (
                  <tr key={o.id as string} className="border-b border-[#E8E7EA] hover:bg-[#FAFAFA]">
                    <td className="py-3 px-4 text-navy">
                      {format(new Date(o.createdAt as string), "MMM d")}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-navy text-xs">{`${account?.firstName} ${account?.lastName}`}</p>
                      <p className="text-[#8A8D93] text-xs">{account?.email as string}</p>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-[#8A8D93] text-xs">
                      {(o.items as { name: string; quantity: number }[])
                        ?.map((i) => `${i.name} ×${i.quantity}`)
                        .join(", ")}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={statusVariant[o.status as string] ?? "neutral"}>
                        {(o.status as string)?.charAt(0) +
                          (o.status as string)?.slice(1).toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={o.status as string}
                        onChange={(e) => updateStatus(o.id as string, e.target.value)}
                        disabled={updatingId === o.id}
                        className="text-xs border border-[#E8E7EA] rounded-lg px-2 py-1.5 bg-white outline-none focus:border-primary"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s.charAt(0) + s.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 0 && (
            <div className="text-center py-12 text-[#8A8D93]">No orders yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
