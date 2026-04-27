// Status badge: READY / IN PROGRESS / NOT STARTED.
// Used for the per-agent readiness indicator.
const STYLES = {
  ready:   { bg: "#1a4d2e", color: "#4ade80", text: "READY" },
  partial: { bg: "#4D1F3B", color: "#FFE566", text: "IN PROGRESS" },
  missing: { bg: "#3d1525", color: "#FF7866", text: "NOT STARTED" },
};

export default function Badge({ type }) {
  const s = STYLES[type] || STYLES.missing;
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {s.text}
    </span>
  );
}
