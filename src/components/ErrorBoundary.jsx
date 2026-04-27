import { Component } from "react";
import { clearSnapshot } from "../utils/storage";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Future: send to logging service
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  async handleClearAndReload() {
    await clearSnapshot();
    window.location.reload();
  }

  handleReset() {
    this.setState({ error: null, errorInfo: null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const errorMsg = this.state.error?.message || String(this.state.error);
    const stack = this.state.errorInfo?.componentStack || this.state.error?.stack || "";

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#27133A", color: "#E8DFF6", fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
        <div className="max-w-2xl w-full rounded-xl p-6" style={{ background: "#1a0d2e", border: "1px solid #4D1F3B" }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-2xl">⚠️</div>
            <div>
              <div className="font-bold text-lg" style={{ color: "#FF7866" }}>Something went wrong</div>
              <div className="text-xs" style={{ color: "#7a5f9a" }}>The tool hit an unexpected error. Your data isn't lost — try one of the options below.</div>
            </div>
          </div>

          <div className="rounded-lg p-3 mb-4 text-xs font-mono" style={{ background: "#27133A", border: "1px solid #4D1F3B", color: "#FF7866" }}>
            {errorMsg}
          </div>

          {stack && (
            <details className="mb-4">
              <summary className="text-xs cursor-pointer" style={{ color: "#7a5f9a" }}>Show technical details</summary>
              <pre className="text-xs mt-2 p-2 rounded overflow-x-auto" style={{ background: "#27133A", color: "#b8a5d4", border: "1px solid #3d2057", fontFamily: "monospace" }}>{stack}</pre>
            </details>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => this.handleReset()}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ background: "#8F68D3", color: "#27133A" }}>
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:bg-purple-900/30"
              style={{ borderColor: "#4D1F3B", color: "#b8a5d4" }}>
              Reload page
            </button>
            <button
              onClick={() => this.handleClearAndReload()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:bg-purple-900/30"
              style={{ borderColor: "#4D1F3B", color: "#FF7866" }}
              title="Clears IndexedDB cache. You'll need to re-upload your files.">
              Clear cache & reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
