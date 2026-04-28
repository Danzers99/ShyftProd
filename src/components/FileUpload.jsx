import { useRef, useState, useCallback } from "react";

/**
 * Drop-zone upload card with:
 * - Click to open native file picker
 * - Drag & drop support (drop CSVs anywhere on the card)
 * - Required vs optional indicator
 * - Per-file size display
 * - Schema validation warnings (yellow border + message)
 *
 * Props:
 * - label, sublabel: card title and helper text
 * - onFiles: callback receiving an array of File objects
 * - multiple: allow multi-file selection
 * - files: current array of selected files
 * - validation: { warnings: string[] } — surfaces yellow warning if present
 * - required: boolean — show a "Required" badge if true
 */
export default function FileUpload({ label, sublabel, onFiles, multiple, files, validation, required }) {
  const ref = useRef();
  const [isDragOver, setIsDragOver] = useState(false);
  const hasWarning = validation?.warnings?.length > 0;
  const hasFiles = files?.length > 0;
  const isMissingRequired = required && !hasFiles;

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".csv"));
    if (dropped.length) onFiles(multiple ? dropped : [dropped[0]]);
  }, [onFiles, multiple]);

  // Border color priority: warning > drag-over > has files > missing required > default
  const borderColor = hasWarning ? "var(--c-yellow)"
    : isDragOver ? "var(--c-pink)"
    : hasFiles ? "var(--c-primary)"
    : isMissingRequired ? "var(--c-border-strong)"
    : "var(--c-border-strong)";

  const titleColor = hasFiles ? "var(--c-primary)"
    : isMissingRequired ? "var(--c-orange)"
    : "var(--c-text-muted)";

  return (
    <div
      className="relative border border-dashed rounded-lg p-3 cursor-pointer transition-all hover:border-purple-400 hover:bg-purple-950/20"
      style={{ borderColor, background: isDragOver ? "rgba(255,102,196,0.05)" : "transparent" }}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input ref={ref} type="file" accept=".csv" multiple={multiple}
        className="hidden" onChange={e => onFiles(Array.from(e.target.files))} />

      <div className="flex items-start justify-between gap-2 mb-0.5">
        <div className="text-sm font-semibold" style={{ color: titleColor }}>{label}</div>
        {required ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: hasFiles ? "var(--c-success-bg)" : "var(--c-warning-bg)",
                     color: hasFiles ? "var(--c-success)" : "var(--c-yellow)" }}>
            {hasFiles ? "✓" : "Required"}
          </span>
        ) : !hasFiles && (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: "var(--c-text-faint)" }}>
            Optional
          </span>
        )}
      </div>

      <div className="text-xs" style={{ color: "var(--c-text-dim)" }}>{sublabel}</div>

      {hasFiles && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{ background: "var(--c-border-strong)", color: "var(--c-pink)" }}
              title={`${f.size ? Math.round(f.size / 1024) + " KB" : ""}`}>
              {f.name}
              {f.size && <span className="opacity-60">{Math.round(f.size / 1024)}k</span>}
            </span>
          ))}
        </div>
      )}

      {hasWarning && (
        <div className="mt-2 text-xs px-2 py-1 rounded"
          style={{ background: "rgba(255,229,102,0.1)", border: "1px solid var(--c-yellow)", color: "var(--c-yellow)" }}>
          ⚠ {validation.warnings.join(" · ")}
        </div>
      )}

      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none"
          style={{ background: "rgba(255,102,196,0.1)", border: "2px dashed var(--c-pink)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--c-pink)" }}>Drop CSV here</span>
        </div>
      )}
    </div>
  );
}
