import { createContext, useContext, useState, useCallback, useRef } from "react";

/**
 * Lightweight toast notification system.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Copied to clipboard");
 *   toast.info("Exported 96 rows");
 *   toast.error("Couldn't read file");
 *   toast.warn("Data is from yesterday");
 *
 * Toasts auto-dismiss after 3 seconds. Multiple toasts stack.
 * No external dependencies — ~120 lines including the visual component.
 */

const ToastContext = createContext(null);

const VARIANTS = {
  success: { bg: "#1a4d2e", border: "#4ade80", color: "#4ade80", icon: "✓" },
  info:    { bg: "#794EC222", border: "#8F68D3", color: "#8F68D3", icon: "ℹ" },
  warn:    { bg: "#3d300033", border: "#FFE566", color: "#FFE566", icon: "⚠" },
  error:   { bg: "#3d152533", border: "#FF7866", color: "#FF7866", icon: "✕" },
};

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timeoutsRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const t = timeoutsRef.current.get(id);
    if (t) { clearTimeout(t); timeoutsRef.current.delete(id); }
  }, []);

  const show = useCallback((variant, message, opts = {}) => {
    const id = ++toastIdCounter;
    const duration = opts.duration ?? 3000;
    setToasts(prev => [...prev, { id, variant, message }]);
    const handle = setTimeout(() => dismiss(id), duration);
    timeoutsRef.current.set(id, handle);
    return id;
  }, [dismiss]);

  const api = {
    success: (msg, opts) => show("success", msg, opts),
    info: (msg, opts) => show("info", msg, opts),
    warn: (msg, opts) => show("warn", msg, opts),
    error: (msg, opts) => show("error", msg, { duration: 5000, ...opts }), // errors stick longer
    dismiss,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback if used outside provider — falls back to console
    return {
      success: (m) => console.log("[toast.success]", m),
      info: (m) => console.log("[toast.info]", m),
      warn: (m) => console.warn("[toast.warn]", m),
      error: (m) => console.error("[toast.error]", m),
      dismiss: () => {},
    };
  }
  return ctx;
}

function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 420 }}>
      {toasts.map(t => {
        const v = VARIANTS[t.variant] || VARIANTS.info;
        return (
          <div
            key={t.id}
            className="pointer-events-auto rounded-lg px-3 py-2.5 flex items-start gap-3 shadow-lg"
            style={{
              background: v.bg,
              border: `1px solid ${v.border}`,
              color: v.color,
              backdropFilter: "blur(8px)",
              animation: "toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              minWidth: 240,
            }}
            role={t.variant === "error" ? "alert" : "status"}
          >
            <span className="text-sm font-bold">{v.icon}</span>
            <span className="text-sm flex-1" style={{ color: "var(--c-text)" }}>{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="text-sm opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: "var(--c-text-muted)" }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
