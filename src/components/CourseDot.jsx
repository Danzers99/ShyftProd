// Tiny per-course indicator dot used in the wide table view.
// Green = course completed, orange = not completed.
export default function CourseDot({ done, title }) {
  return (
    <div title={title} className="w-3 h-3 rounded-sm flex-shrink-0"
      style={{ background: done ? "#22c55e" : "#FF7866", opacity: done ? 1 : 0.6 }} />
  );
}
