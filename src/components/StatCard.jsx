// Top-of-dashboard summary card: label, big number, sub-text.
export default function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "#1a0d2e", border: "1px solid #3d2057" }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a5f9a" }}>{label}</div>
      <div className="text-3xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "#b8a5d4" }}>{sub}</div>}
    </div>
  );
}
