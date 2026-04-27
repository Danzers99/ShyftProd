import { useRef } from "react";

/**
 * Drop-zone upload card with optional schema validation feedback.
 *
 * Props:
 * - label, sublabel: card title and helper text
 * - onFiles: callback receiving an array of File objects
 * - multiple: allow multi-file selection
 * - files: current array of selected files
 * - validation: { warnings: string[] } — surfaces yellow warning if present
 */
export default function FileUpload({ label, sublabel, onFiles, multiple, files, validation }) {
  const ref = useRef();
  const hasWarning = validation?.warnings?.length > 0;
  return (
    <div
      className="relative border border-dashed rounded-lg p-3 cursor-pointer transition-all hover:border-purple-400 hover:bg-purple-950/20"
      style={{ borderColor: hasWarning ? "#FFE566" : files?.length ? "#8F68D3" : "#4D1F3B" }}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept=".csv" multiple={multiple}
        className="hidden" onChange={e => onFiles(Array.from(e.target.files))} />
      <div className="text-sm font-semibold" style={{ color: files?.length ? "#8F68D3" : "#b8a5d4" }}>{label}</div>
      <div className="text-xs mt-0.5" style={{ color: "#7a5f9a" }}>{sublabel}</div>
      {files?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#4D1F3B", color: "#FF66C4" }}>
              {f.name}
            </span>
          ))}
        </div>
      )}
      {hasWarning && (
        <div className="mt-2 text-xs px-2 py-1 rounded" style={{ background: "#3d300033", border: "1px solid #FFE566", color: "#FFE566" }}>
          ⚠ {validation.warnings.join(" · ")}
        </div>
      )}
    </div>
  );
}
