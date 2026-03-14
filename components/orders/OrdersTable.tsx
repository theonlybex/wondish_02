"use client";

import { useState } from "react";
import { format } from "date-fns";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { OrderDTO } from "@/types";

interface OrdersTableProps {
  initialOrders: OrderDTO[];
  initialTotal: number;
  limit?: number;
}

const statusVariant: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  PENDING: "neutral",
  CONFIRMED: "info",
  PREPARING: "warning",
  DELIVERED: "success",
  CANCELED: "error",
};

export default function OrdersTable({
  initialOrders,
  initialTotal,
  limit = 10,
}: OrdersTableProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.ceil(total / limit);

  const loadPage = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders?page=${p}&limit=${limit}`);
      const data = await res.json();
      setOrders(data.orders ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E8E7EA]">
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Date</th>
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden md:table-cell">Items</th>
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden sm:table-cell">Total</th>
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-[#E8E7EA] hover:bg-[#FAFAFA]">
                <td className="py-3 px-4 text-navy font-medium">
                  {format(new Date(order.createdAt), "MMM d, yyyy")}
                </td>
                <td className="py-3 px-4 hidden md:table-cell text-[#8A8D93]">
                  {order.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                </td>
                <td className="py-3 px-4 hidden sm:table-cell text-navy">
                  {order.totalAmount != null ? `$${order.totalAmount.toFixed(2)}` : "—"}
                </td>
                <td className="py-3 px-4">
                  <Badge variant={statusVariant[order.status] ?? "neutral"}>
                    {order.status.charAt(0) + order.status.slice(1).toLowerCase()}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {orders.length === 0 && (
          <div className="text-center py-12 text-[#8A8D93]">No orders yet.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E8E7EA]">
          <p className="text-[#8A8D93] text-xs">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              loading={loading}
              onClick={() => loadPage(page - 1)}
            >
              ‹ Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === totalPages}
              loading={loading}
              onClick={() => loadPage(page + 1)}
            >
              Next ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
