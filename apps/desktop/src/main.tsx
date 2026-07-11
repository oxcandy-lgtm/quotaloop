import React from "react";
import ReactDOM from "react-dom/client";
import { Gauge, Pause, Play, RefreshCw, Settings } from "lucide-react";
import "./styles.css";
function App() {
  return (
    <main className="popover">
      <header>
        <div className="mark">
          <Gauge />
        </div>
        <strong>QuotaLoop</strong>
        <span className="online">LOCAL</span>
      </header>
      <section className="overall">
        <span>OVERALL</span>
        <strong>3 providers ready</strong>
        <small>1 provider unavailable</small>
      </section>
      <section className="provider">
        <div>
          <b>Codex Demo</b>
          <span>DEMO</span>
        </div>
        <p>
          <label>
            Session <strong>72%</strong>
          </label>
          <i>
            <em style={{ width: "72%" }} />
          </i>
        </p>
        <p>
          <label>
            Weekly <strong>64%</strong>
          </label>
          <i>
            <em style={{ width: "64%" }} />
          </i>
        </p>
        <small>Reset in 2h 14m · synthetic data</small>
      </section>
      <section className="provider compact">
        <div>
          <b>Claude Code</b>
          <span className="detect">DETECTED</span>
        </div>
        <small>Verified quota source unavailable</small>
      </section>
      <section className="automation">
        <div>
          <span>AUTOMATION</span>
          <strong>
            <Pause />
            Off
          </strong>
        </div>
        <small>Safe default · enable in dashboard</small>
      </section>
      <nav>
        <button>
          <RefreshCw />
          Refresh
        </button>
        <button>
          <Play />
          Run demo
        </button>
        <button className="primary">
          <Settings />
          Dashboard
        </button>
      </nav>
    </main>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
