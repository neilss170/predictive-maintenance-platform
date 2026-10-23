import { useEffect, useMemo, useState } from "react";
import { EngineRul } from "./EngineRul.jsx";
import { FleetAssessment } from "./FleetAssessment.jsx";

const DEFAULT_INPUTS = {
  type: "L",
  airTemperature: 298.1,
  processTemperature: 308.6,
  rotationalSpeed: 1551,
  torque: 42.8,
  toolWear: 0,
};

const STRESS_INPUTS = {
  type: "L",
  airTemperature: 300.7,
  processTemperature: 310.5,
  rotationalSpeed: 1370,
  torque: 65,
  toolWear: 220,
};

const FIELDS = [
  { name: "airTemperature", label: "Air temperature", unit: "K", min: 290, max: 310, step: 0.1 },
  { name: "processTemperature", label: "Process temperature", unit: "K", min: 300, max: 320, step: 0.1 },
  { name: "rotationalSpeed", label: "Rotational speed", unit: "rpm", min: 1000, max: 3000, step: 1 },
  { name: "torque", label: "Torque", unit: "Nm", min: 0, max: 80, step: 0.1 },
  { name: "toolWear", label: "Tool wear", unit: "min", min: 0, max: 260, step: 1 },
];

function transformInputs(inputs, model) {
  const temperatureDifference = Number(inputs.processTemperature) - Number(inputs.airTemperature);
  const mechanicalPower = (2 * Math.PI * Number(inputs.rotationalSpeed) * Number(inputs.torque)) / 60;
  const rawNumeric = [
    Number(inputs.airTemperature),
    Number(inputs.processTemperature),
    Number(inputs.rotationalSpeed),
    Number(inputs.torque),
    Number(inputs.toolWear),
    temperatureDifference,
    mechanicalPower,
    Number(inputs.torque) * Number(inputs.toolWear),
  ];
  const standardized = rawNumeric.map(
    (value, index) => Math.fround((value - model.means[index]) / model.scales[index]),
  );
  const encodedType = model.typeCategories.map((category) => (category === inputs.type ? 1 : 0));
  return { vector: [...standardized, ...encodedType], temperatureDifference, mechanicalPower };
}

function scoreForest(vector, model) {
  let probability = 0;
  for (const tree of model.trees) {
    let node = 0;
    while (tree.l[node] !== -1) {
      node = vector[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
    }
    probability += tree.p[node];
  }
  return probability / model.trees.length;
}

function calculateResult(inputs, model) {
  if (!inputs || !model) return null;
  const transformed = transformInputs(inputs, model);
  const probability = scoreForest(transformed.vector, model);
  return { ...transformed, probability, flagged: probability >= model.decisionThreshold };
}

function riskLevel(probability, threshold) {
  if (probability < threshold * 0.5) return { label: "Low", className: "low" };
  if (probability < threshold) return { label: "Watch", className: "watch" };
  if (probability < Math.max(threshold * 2.5, 0.5)) return { label: "High", className: "high" };
  return { label: "Critical", className: "critical" };
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function downloadHistory(history) {
  const header = "timestamp,type,air_temperature,process_temperature,rotational_speed,torque,tool_wear,probability,status";
  const rows = history.map((item) => [
    item.timestamp, item.inputs.type, item.inputs.airTemperature, item.inputs.processTemperature,
    item.inputs.rotationalSpeed, item.inputs.torque, item.inputs.toolWear,
    item.probability.toFixed(6), item.flagged ? "Flagged" : "Monitor",
  ].join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "maintenance-assessment-history.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [model, setModel] = useState(null);
  const [modelError, setModelError] = useState("");
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [scoredInputs, setScoredInputs] = useState(DEFAULT_INPUTS);
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pm-history")) || []; } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState("single");

  useEffect(() => {
    fetch("/model.json")
      .then((response) => {
        if (!response.ok) throw new Error("Model asset could not be loaded.");
        return response.json();
      })
      .then(setModel)
      .catch((error) => setModelError(error.message));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("pm-history", JSON.stringify(history));
    } catch {
      // Storage may be unavailable in private or embedded browser contexts.
    }
  }, [history]);

  const result = useMemo(() => calculateResult(scoredInputs, model), [scoredInputs, model]);
  const baselineResult = useMemo(() => calculateResult(baseline, model), [baseline, model]);

  function updateField(name, value) {
    setInputs((current) => ({ ...current, [name]: name === "type" ? value : Number(value) }));
  }

  function saveAssessment() {
    if (!result) return;
    setHistory((current) => [{
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      inputs: { ...scoredInputs },
      probability: result.probability,
      flagged: result.flagged,
    }, ...current].slice(0, 20));
    setShowHistory(true);
  }

  const probabilityPercent = result ? result.probability * 100 : 0;
  const thresholdPercent = model ? model.decisionThreshold * 100 : 0;
  const currentRisk = result && model ? riskLevel(result.probability, model.decisionThreshold) : null;
  const comparison = baselineResult && result ? (result.probability - baselineResult.probability) * 100 : null;
  const hasPendingChanges = JSON.stringify(inputs) !== JSON.stringify(scoredInputs);

  function openFleetMachine(machineInputs) {
    setInputs(machineInputs);
    setScoredInputs(machineInputs);
    setView("single");
    globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">PM</span>
          <div><p>Reliability Lab</p><strong>Predictive Maintenance</strong></div>
        </div>
        <div className="topbar-actions">
          <button className="history-button" type="button" onClick={() => setShowHistory((value) => !value)}>
            History <span>{history.length}</span>
          </button>
          <span className="benchmark-badge">AI4I + NASA C-MAPSS</span>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Failure risk + remaining useful life</p>
            <h1>Know which machines are at risk, and how long they have left.</h1>
            <p className="hero-copy">Two leakage-safe models in one console. A failure-risk classifier scores machine operating readings, and a remaining-useful-life model forecasts how many cycles a turbofan engine has left. Each was evaluated once on data it never saw.</p>
          </div>
          <div className="hero-metrics" aria-label="Model benchmark metrics">
            <Metric label="Failure PR-AUC" value="0.957" />
            <Metric label="RUL test RMSE" value="12.9 cycles" />
            <Metric label="30-cycle alarm recall" value="92%" />
          </div>
        </section>

        <nav className="view-tabs" aria-label="Dashboard views">
          <button className={view === "single" ? "active" : ""} type="button" onClick={() => setView("single")}>Single machine</button>
          <button className={view === "fleet" ? "active" : ""} type="button" onClick={() => setView("fleet")}>Fleet assessment</button>
          <button className={view === "rul" ? "active" : ""} type="button" onClick={() => setView("rul")}>Engine RUL</button>
        </nav>

        {view === "fleet" && (model ? (
          <FleetAssessment
            model={model}
            scoreInputs={(machineInputs) => {
              const scored = calculateResult(machineInputs, model);
              return { ...scored, risk: riskLevel(scored.probability, model.decisionThreshold) };
            }}
            onOpenMachine={openFleetMachine}
          />
        ) : <div className="fleet-loading">Loading fleet scoring model...</div>)}

        {view === "rul" && <EngineRul />}

        {showHistory && view === "single" && (
          <section className="history-panel" aria-label="Assessment history">
            <div className="panel-heading">
              <div><p className="eyebrow">Local session</p><h2>Assessment history</h2></div>
              <div className="inline-actions">
                <button className="text-button" type="button" disabled={!history.length} onClick={() => downloadHistory(history)}>Export CSV</button>
                <button className="text-button danger" type="button" disabled={!history.length} onClick={() => setHistory([])}>Clear</button>
              </div>
            </div>
            {!history.length ? <p className="empty-copy">Save a risk assessment to build a local comparison history.</p> : (
              <div className="history-list">
                {history.map((item) => (
                  <button className="history-row" type="button" key={item.id} onClick={() => { setInputs(item.inputs); setScoredInputs(item.inputs); }}>
                    <span><strong>{item.inputs.type}-type machine</strong><small>{new Date(item.timestamp).toLocaleString()}</small></span>
                    <span><strong>{(item.probability * 100).toFixed(1)}%</strong><small>{item.flagged ? "Review" : "Monitor"}</small></span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className={`workspace ${view !== "single" ? "is-hidden" : ""}`}>
          <form className="input-panel" onSubmit={(event) => event.preventDefault()}>
            <div className="panel-heading">
              <div><p className="eyebrow">Current observation</p><h2>Operating inputs</h2></div>
              <button className="text-button" type="button" onClick={() => { setInputs(DEFAULT_INPUTS); setScoredInputs(DEFAULT_INPUTS); }}>Reset</button>
            </div>

            <fieldset className="type-selector">
              <legend>Product type</legend>
              <div>{["L", "M", "H"].map((type) => (
                <label key={type}>
                  <input type="radio" name="type" value={type} checked={inputs.type === type} onChange={(event) => updateField("type", event.target.value)} />
                  <span>{type}</span>
                </label>
              ))}</div>
            </fieldset>

            <div className="field-grid">
              {FIELDS.map(({ name, label, unit, min, max, step }) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <div className="input-wrap">
                    <input aria-label={label} type="number" value={inputs[name]} min={min} max={max} step={step} onChange={(event) => updateField(name, event.target.value)} />
                    <small>{unit}</small>
                  </div>
                  <input className="range-input" aria-label={`${label} slider`} type="range" value={inputs[name]} min={min} max={max} step={step} onChange={(event) => updateField(name, event.target.value)} />
                  <span className="range-labels"><small>{min}</small><small>{max}</small></span>
                </label>
              ))}
            </div>

            <div className="button-row">
              <button className="secondary-button" type="button" onClick={() => setInputs(STRESS_INPUTS)}>Load stress example</button>
              <button className="secondary-button" type="button" onClick={() => setBaseline({ ...scoredInputs })}>Pin current result</button>
            </div>
            <button className="primary-button" type="button" disabled={!model} onClick={() => setScoredInputs({ ...inputs })}>
              {hasPendingChanges ? "Calculate updated risk" : "Risk score is up to date"}
            </button>
            <p className="scoring-note">Inputs can be adjusted freely. The model runs only when you calculate, preventing repeated heavy scoring during slider movement.</p>
          </form>

          <aside className={`result-panel ${result?.flagged ? "flagged" : ""}`}>
            {modelError ? (
              <div className="error-state"><p className="eyebrow">Model unavailable</p><h2>Risk score could not be loaded.</h2><p>{modelError}</p></div>
            ) : !result ? (
              <div className="loading-state"><span className="loader" /><p>Loading 500-tree model...</p></div>
            ) : (
              <>
                <div className="result-heading">
                  <div><p className="eyebrow">Model result</p><h2>{result.flagged ? "Maintenance review recommended" : "Below review threshold"}</h2></div>
                  <span className={`status-pill ${currentRisk.className}`}>{currentRisk.label}</span>
                </div>
                <div className="score"><strong>{probabilityPercent.toFixed(1)}%</strong><span>estimated failure probability</span></div>
                <div className="gauge" aria-label="Failure probability">
                  <div className="gauge-fill" style={{ width: `${Math.max(probabilityPercent, 1)}%` }} />
                  <span className="threshold-marker" style={{ left: `${thresholdPercent}%` }} title={`Decision threshold ${thresholdPercent.toFixed(1)}%`} />
                </div>
                <div className="gauge-labels"><span>0%</span><span>Review threshold {thresholdPercent.toFixed(1)}%</span><span>100%</span></div>

                {comparison !== null && (
                  <div className="comparison-card">
                    <div><span>Compared with pinned scenario</span><strong className={comparison <= 0 ? "improved" : "worsened"}>{comparison > 0 ? "+" : ""}{comparison.toFixed(1)} pts</strong></div>
                    <button type="button" onClick={() => { setInputs(baseline); setScoredInputs(baseline); setBaseline(null); }}>Restore pinned</button>
                  </div>
                )}

                <div className="derived-grid">
                  <Metric label="Temperature delta" value={`${result.temperatureDifference.toFixed(1)} K`} />
                  <Metric label="Mechanical power" value={`${Math.round(result.mechanicalPower).toLocaleString()} W`} />
                </div>

                <div className="action-card">
                  <strong>Suggested next step</strong>
                  <p>{result.flagged ? "Verify sensor readings, review recent maintenance records, and schedule an engineering inspection." : "Continue routine monitoring and reassess when operating conditions or tool wear change."}</p>
                  <button className="save-button" type="button" onClick={saveAssessment}>Save assessment</button>
                </div>
              </>
            )}
          </aside>
        </section>

        <section className={`insight-grid ${view !== "single" ? "is-hidden" : ""}`}>
          <article className="insight-card">
            <p className="eyebrow">Operating context</p><h2>Current signal profile</h2>
            <div className="signal-list">
              {FIELDS.map((field) => {
                const position = ((inputs[field.name] - field.min) / (field.max - field.min)) * 100;
                return <div className="signal-row" key={field.name}><span>{field.label}<strong>{inputs[field.name]} {field.unit}</strong></span><div><i style={{ width: `${Math.min(100, Math.max(0, position))}%` }} /></div></div>;
              })}
            </div>
            <p className="card-note">Positions show the configured dashboard range, not causal feature importance.</p>
          </article>
          <article className="insight-card">
            <p className="eyebrow">Decision checklist</p><h2>Human review remains in control</h2>
            <ul className="checklist">
              <li><span>1</span><div><strong>Confirm the observation</strong><p>Check units, sensor health, and whether readings represent the same operating moment.</p></div></li>
              <li><span>2</span><div><strong>Compare operating scenarios</strong><p>Pin the current state, adjust controls, and inspect the model response.</p></div></li>
              <li><span>3</span><div><strong>Record the decision</strong><p>Save or export the assessment before scheduling any maintenance action.</p></div></li>
            </ul>
          </article>
        </section>

        {view === "rul" ? (
          <section className="method-strip">
            <div><p className="eyebrow">Engine-grouped by design</p><h2>Every engine is either training data or test data, never both.</h2></div>
            <div className="method-columns">
              <div><strong>Causal features</strong><p>14 informative sensors with rolling mean, rolling spread, 20-cycle trend, and drift from each engine's own early-life level. Each value uses only cycles already observed.</p></div>
              <div><strong>Honest selection</strong><p>Five models compared with 5-fold GroupKFold over training engines. The official test set was scored once, after selection.</p></div>
              <div><strong>Validation boundary</strong><p>Single operating condition and fault mode (FD001). Simulated engines, so real fleets need re-validation.</p></div>
            </div>
          </section>
        ) : (
        <section className="method-strip">
          <div><p className="eyebrow">Leakage-safe by design</p><h2>What the model sees—and what it never sees.</h2></div>
          <div className="method-columns">
            <div><strong>Eligible signals</strong><p>Product type, temperatures, rotational speed, torque, tool wear, temperature delta, mechanical power, and their governed interaction.</p></div>
            <div><strong>Always excluded</strong><p>UDI, Product ID, and the TWF, HDF, PWF, OSF, and RNF post-outcome failure-mode labels.</p></div>
            <div><strong>Validation boundary</strong><p>Synthetic UCI data with a stratified benchmark split—not time-aware production validation.</p></div>
          </div>
        </section>
        )}
      </main>
      <footer><p>Predictive Maintenance Risk Console</p><p>Benchmark demonstration • Model decisions require human review</p></footer>
    </div>
  );
}
