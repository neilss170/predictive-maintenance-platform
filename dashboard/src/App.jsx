import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { activeThreshold, CostPolicy, DEFAULT_POLICY } from "./CostPolicy.jsx";
import { EngineRul } from "./EngineRul.jsx";
import { RuleCheck, WhatIf, WhyScore } from "./Explain.jsx";
import { FleetAssessment } from "./FleetAssessment.jsx";
import { calculateResult, explainInputs, FIELDS, ruleStatus, SCENARIOS, thresholdCrossings } from "./forest.js";
import { InfoTip } from "./InfoTip.jsx";
import { ModelPerformance } from "./ModelPerformance.jsx";
import { riskLevel } from "./risk.js";
import { Tour } from "./Tour.jsx";

const DEFAULT_INPUTS = SCENARIOS[0].inputs;

function Metric({ label, value, term }) {
  return <div className="metric"><span>{label}{term && <InfoTip term={term} label={`What is ${label}?`} />}</span><strong>{value}</strong></div>;
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
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pm-history")) || []; } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState("single");
  const [costCurve, setCostCurve] = useState(null);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [touring, setTouring] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try { return localStorage.getItem("pm-welcome-dismissed") === "1"; } catch { return false; }
  });

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}cost-curve.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then(setCostCurve)
      .catch(() => setCostCurve(null));
    fetch(`${import.meta.env.BASE_URL}model.json`)
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

  const threshold = model ? activeThreshold(costCurve, policy, model.decisionThreshold) : 0;
  // Scoring follows the inputs live; the deferred copy keeps sliders smooth
  // while the explanation and what-if search catch up.
  const scoredInputs = useDeferredValue(inputs);
  const result = useMemo(() => calculateResult(scoredInputs, model, threshold), [scoredInputs, model, threshold]);
  const explanation = useMemo(() => (model ? explainInputs(scoredInputs, model) : null), [scoredInputs, model]);
  const crossings = useMemo(() => (model ? thresholdCrossings(scoredInputs, model, threshold) : null), [scoredInputs, model, threshold]);
  const rules = useMemo(() => ruleStatus(scoredInputs), [scoredInputs]);
  const activeScenario = SCENARIOS.find((scenario) => JSON.stringify(scenario.inputs) === JSON.stringify(inputs));
  const explainMachine = useCallback((machineInputs) => explainInputs(machineInputs, model), [model]);
  const baselineResult = useMemo(() => calculateResult(baseline, model, threshold), [baseline, model, threshold]);

  function updateField(name, value) {
    setInputs((current) => ({ ...current, [name]: name === "type" ? value : Number(value) }));
  }

  function dismissWelcome() {
    setWelcomeDismissed(true);
    try { localStorage.setItem("pm-welcome-dismissed", "1"); } catch {
      // Storage may be unavailable; the banner just returns next visit.
    }
  }

  function startTour() {
    dismissWelcome();
    setTouring(true);
  }

  // The tour walks the single-machine view; switch to it for steps that live there.
  const prepareTourStep = useCallback((target) => {
    if (target !== "tabs") setView("single");
  }, []);

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
  const thresholdPercent = threshold * 100;
  const currentRisk = result && model ? riskLevel(result.probability, threshold) : null;
  const comparison = baselineResult && result ? (result.probability - baselineResult.probability) * 100 : null;

  function openFleetMachine(machineInputs) {
    setInputs(machineInputs);
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
          <button className="history-button" type="button" onClick={startTour}>Tour</button>
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
            <Metric label="Failure PR-AUC" value="0.957" term="prAuc" />
            <Metric label="RUL test RMSE" value="12.9 cycles" term="rmse" />
            <Metric label="30-cycle alarm recall" value="92%" term="alarmRecall" />
          </div>
        </section>

        {!welcomeDismissed && (
          <div className="welcome" role="note">
            <div><strong>New here?</strong> Take a one-minute tour: what each view does, how to set costs, and how to read a score.</div>
            <div className="inline-actions">
              <button type="button" className="primary-button" onClick={startTour}>Take the tour</button>
              <button type="button" className="text-button" onClick={dismissWelcome}>Dismiss</button>
            </div>
          </div>
        )}

        <nav className="view-tabs" aria-label="Dashboard views" data-tour="tabs">
          <button className={view === "single" ? "active" : ""} type="button" onClick={() => setView("single")}>Single machine</button>
          <button className={view === "fleet" ? "active" : ""} type="button" onClick={() => setView("fleet")}>Fleet assessment</button>
          <button className={view === "performance" ? "active" : ""} type="button" onClick={() => setView("performance")}>Model performance</button>
          <button className={view === "rul" ? "active" : ""} type="button" onClick={() => setView("rul")}>Engine RUL</button>
        </nav>

        {view !== "rul" && <CostPolicy curve={costCurve} policy={policy} onChange={setPolicy} />}

        {view === "fleet" && (model ? (
          <FleetAssessment
            threshold={threshold}
            scoreInputs={(machineInputs) => ({ probability: calculateResult(machineInputs, model, threshold).probability })}
            explain={explainMachine}
            onOpenMachine={openFleetMachine}
          />
        ) : <div className="fleet-loading">Loading fleet scoring model...</div>)}

        {view === "performance" && (model
          ? <ModelPerformance model={model} threshold={threshold} onOpenMachine={openFleetMachine} />
          : <div className="fleet-loading">Loading the failure model...</div>)}

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
                  <button className="history-row" type="button" key={item.id} onClick={() => setInputs(item.inputs)}>
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
              <button className="text-button" type="button" onClick={() => setInputs(DEFAULT_INPUTS)}>Reset</button>
            </div>

            <div className="scenario-picker" data-tour="scenarios">
              <span>Try a scenario</span>
              <div role="group" aria-label="Example scenarios">
                {SCENARIOS.map((scenario) => (
                  <button key={scenario.key} type="button" title={scenario.note}
                    className={activeScenario?.key === scenario.key ? "active" : ""} onClick={() => setInputs(scenario.inputs)}>
                    {scenario.label}
                  </button>
                ))}
              </div>
              <small>{activeScenario ? activeScenario.note : "Custom readings. Move any slider and the score updates instantly."}</small>
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
              <button className="secondary-button" type="button" onClick={() => setBaseline({ ...inputs })}>Pin to compare</button>
              <button className="secondary-button" type="button" disabled={!result} onClick={saveAssessment}>Save assessment</button>
            </div>
            <p className="scoring-note">The 500-tree model scores in your browser as you move the sliders. Pin a result, change readings, and compare.</p>
          </form>

          <aside className={`result-panel ${result?.flagged ? "flagged" : ""}`} data-tour="result">
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
                <div className="score"><strong>{probabilityPercent.toFixed(1)}%</strong><span>estimated failure probability <InfoTip term="probability" /></span></div>
                <div className="gauge" aria-label="Failure probability">
                  <div className="gauge-fill" style={{ width: `${Math.max(probabilityPercent, 1)}%` }} />
                  <span className="threshold-marker" style={{ left: `${thresholdPercent}%` }} title={`Decision threshold ${thresholdPercent.toFixed(1)}%`} />
                </div>
                <div className="gauge-labels"><span>0%</span><span>Review threshold {thresholdPercent.toFixed(1)}% <InfoTip term="threshold" /></span><span>100%</span></div>

                {comparison !== null && (
                  <div className="comparison-card">
                    <div><span>Compared with pinned scenario</span><strong className={comparison <= 0 ? "improved" : "worsened"}>{comparison > 0 ? "+" : ""}{comparison.toFixed(1)} pts</strong></div>
                    <button type="button" onClick={() => { setInputs(baseline); setBaseline(null); }}>Restore pinned</button>
                  </div>
                )}

                {explanation && <WhyScore explanation={explanation} probability={result.probability} />}
                <WhatIf crossings={crossings} onTry={(move) => setInputs((current) => ({ ...current, [move.name]: move.to }))} />

                <div className="action-card">
                  <strong>Suggested next step</strong>
                  <p>{result.flagged ? "Verify sensor readings, review recent maintenance records, and schedule an engineering inspection." : "Continue routine monitoring and reassess when operating conditions or tool wear change."}</p>
                </div>
              </>
            )}
          </aside>
        </section>

        <section className={`insight-grid ${view !== "single" ? "is-hidden" : ""}`}>
          <article className="insight-card">
            <p className="eyebrow">How machines fail here</p><h2>Failure rules check</h2>
            <RuleCheck rules={rules} />
            <p className="card-note">AI4I failures follow these documented rules. The model never sees them, yet learns them from the data. A further 0.1% of machines fail at random with no warning sign.</p>
          </article>
          <article className="insight-card">
            <p className="eyebrow">Decision checklist</p><h2>Human review remains in control</h2>
            <ul className="checklist">
              <li><span>1</span><div><strong>Confirm the observation</strong><p>Check units, sensor health, and whether readings represent the same operating moment.</p></div></li>
              <li><span>2</span><div><strong>Read the reasons</strong><p>Check which readings drive the score and whether a small, safe change would clear it.</p></div></li>
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
      <Tour open={touring} onClose={() => setTouring(false)} onBeforeStep={prepareTourStep} />
      <footer><p>Predictive Maintenance Risk Console</p><p>Benchmark demonstration • Model decisions require human review</p></footer>
    </div>
  );
}
