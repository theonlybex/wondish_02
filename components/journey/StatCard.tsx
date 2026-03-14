interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  trend?: "up" | "down" | null;
  subtitle?: string;
}

export default function StatCard({ label, value, icon, trend, subtitle }: StatCardProps) {
  return (
    <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span
            className={`text-xs font-semibold ${
              trend === "up" ? "text-success" : "text-error"
            }`}
          >
            {trend === "up" ? "↑" : "↓"}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-navy mb-1">{value}</p>
      <p className="text-[#8A8D93] text-xs font-medium">{label}</p>
      {subtitle && <p className="text-[#8A8D93] text-xs mt-0.5">{subtitle}</p>}
    </div>
  );
}
