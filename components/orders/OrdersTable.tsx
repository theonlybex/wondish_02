"use client";

import { useState } from "react";
import { format } from "date-fns";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { OrderDTO } from "@/types";

interface OrdersTableProps {
  initialOrders: OrderDTO[];
  initialTotal: number;
  totalSpent?: number;
  limit?: number;
}

const statusVariant: Record<
  string,
  "success" | "warning" | "error" | "info" | "neutral"
> = {
  PENDING: "neutral",
  CONFIRMED: "info",
  PREPARING: "warning",
  DELIVERED: "success",
  CANCELED: "error",
};

const statusAccent: Record<string, string> = {
  PENDING: "#8A8D93",
  CONFIRMED: "#00CFE8",
  PREPARING: "#FF9F43",
  DELIVERED: "#4ade80",
  CANCELED: "#EA5455",
};

export default function OrdersTable({
  initialOrders,
  initialTotal,
  totalSpent = 0,
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

  const lastOrder = orders[0];

  const stats = [
    {
      label: "Total Orders",
      value: String(total),
      sub: "",
    },
    {
      label: "Total Spent",
      value: `$${totalSpent.toFixed(2)}`,
      sub: "",
    },
    {
      label: "Last Order",
      value: lastOrder
        ? format(new Date(lastOrder.createdAt), "MMM d")
        : "—",
      sub: lastOrder
        ? format(new Date(lastOrder.createdAt), "yyyy")
        : "",
    },
  ];

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-3 border-b border-[#E8E7EA]" style={{ background: "#FAFCFA" }}>
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={`px-6 py-5 ${i > 0 ? "border-l border-[#E8E7EA]" : ""}`}
          >
            <p
              className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2"
              style={{ color: "#ADBDAD" }}
            >
              {stat.label}
            </p>
            <div className="flex items-baseline gap-1.5">
              <p
                className="font-black tabular-nums text-[#0d1f10] leading-none"
                style={{ fontSize: "1.75rem" }}
              >
                {stat.value}
              </p>
              {stat.sub && (
                <span
                  className="text-sm font-medium leading-none"
                  style={{ color: "#C8D4C8" }}
                >
                  {stat.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Order rows */}
      {orders.length === 0 ? (
        <div className="py-20 text-center">
          <div
            className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-5"
            style={{ background: "#F0F4F0" }}
          >
            📦
          </div>
          <p className="text-[#0d1f10] font-semibold text-lg mb-1">
            No orders yet
          </p>
          <p className="text-sm" style={{ color: "#ADBDAD" }}>
            Your order history will appear here once you place your first order.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#F0F4F0]">
          {orders.map((order) => {
            const accent = statusAccent[order.status] ?? "#8A8D93";
            const variant = statusVariant[order.status] ?? "neutral";
            const label =
              order.status.charAt(0) + order.status.slice(1).toLowerCase();

            return (
              <div
                key={order.id}
                className="flex items-center gap-4 px-6 py-4 hover:bg-[#FAFCFA] transition-colors"
              >
                {/* Status accent bar */}
                <div
                  className="w-0.5 h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accent }}
                />

                {/* Date */}
                <div className="w-20 flex-shrink-0">
                  <p className="text-sm font-bold text-[#0d1f10] leading-snug">
                    {format(new Date(order.createdAt), "MMM d")}
                  </p>
                  <p
                    className="text-[10px] font-medium leading-snug"
                    style={{ color: "#ADBDAD" }}
                  >
                    {format(new Date(order.createdAt), "yyyy")}
                  </p>
                </div>

                {/* Items */}
                <div className="flex-1 min-w-0 hidden sm:block">
                  <p className="text-sm text-[#0d1f10] truncate leading-snug">
                    {order.items.length > 0
                      ? order.items
                          .map((it) => `${it.name} ×${it.quantity}`)
                          .join(", ")
                      : "No items"}
                  </p>
                  <p
                    className="text-[10px] font-medium mt-0.5 leading-snug"
                    style={{ color: "#ADBDAD" }}
                  >
                    {order.items.length} item
                    {order.items.length !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Amount */}
                <div className="flex-shrink-0 text-right w-20">
                  <p className="text-sm font-bold text-[#0d1f10]">
                    {order.totalAmount != null
                      ? `$${order.totalAmount.toFixed(2)}`
                      : "—"}
                  </p>
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0">
                  <Badge variant={variant}>{label}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8E7EA]">
          <p
            className="text-[10px] tracking-[0.2em] uppercase font-bold"
            style={{ color: "#ADBDAD" }}
          >
            Page {page} / {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              loading={loading}
              onClick={() => loadPage(page - 1)}
            >
              ← Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === totalPages}
              loading={loading}
              onClick={() => loadPage(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
