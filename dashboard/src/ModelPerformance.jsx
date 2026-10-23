import { Fragment, useEffect, useMemo, useState } from "react";
import { WhyScore } from "./Explain.jsx";
import { calculateResult, explainInputs } from "./forest.js";
import { InfoTip } from "./InfoTip.jsx";
import { confusion, machinesFrom } from "./performance.js";

const MODE_LABELS = {
  HDF: "Overheating",
  PWF: "Power",
  OSF: "Overstrain",
  TWF: "Tool wear",
  RNF: "Random",
  "": "No type recorded",
};
const MODE_ORDER = ["PWF", "OSF", "HDF", "TWF", "RNF", ""];

const pct = (value) => `${(value * 100).toFixed(1)}%`;

function TradeoffChart({ machines, threshold }) {
  const width = 520;
  const height = 200;
  const pad = { left: 36, right: 12, top: 12, bottom: 28 };
  const failures = machines.filter((machine) => machine.failed).length;
  const points = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    const flagged = machines.filter((machine) => machine.probability >= t);
    const caught = flagged.filter((machine) => machine.failed).length;
    return { t, recall: caught / failures, precision: flagged.length ? caught / flagged.length : 1 };
  });
  const x = (t) => pad.left + t * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - v) * (height - pad.top - pad.bottom);
  const path = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <figure className="tradeoff">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Precision and recall at every threshold on the test set">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.left - 6} y={y(v) + 4} textAnchor="end">{v * 100}%</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={x(t)} y={height - 8} textAnchor="middle">{t * 100}%</text>)}
        <path d={path("recall")} className="recall" />
        <path d={path("precision")} className="precision" />
        <line x1={x(threshold)} x2={x(threshold)} y1={pad.top} y2={height - pad.bottom} className="marker" />
      </svg>
      <figcaption>
        <span><i className="key recall" />Failures caught (recall)</span>
        <span><i className="key precision" />Flags that are real (precision)</span>
        <span><i className="key marker" />Current threshold {pct(threshold)}</span>
      </figcaption>
    </figure>
  );
}

export function ModelPerformance({ model, threshold, onOpenMachine }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("missed");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}test-machines.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Test results could not be loaded.");
        return response.json();
      })
      .then(setData)
      .catch((reason) => setError(reason.message));
  }, []);

  // Scored once per model load; decisions below follow the active threshold.
  const machines = useMemo(() => {
    if (!data || !model) return [];
    return machinesFrom(data).map((machine) => ({ ...machine, probability: calculateResult(machine.inputs, model, 0).probability }));
  }, [data, model]);

  if (error) return <section className="fleet-panel"><p className="upload-error">{error}</p></section>;
  if (!machines.length) return <div className="fleet-loading">Scoring 1,500 held-out machines...</div>;

  const counts = confusion(machines, threshold);
  const failures = counts.tp + counts.fn;
  const precision = counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : 0;
  const recall = counts.tp / failures;
  const summary = data.summary;

  const byMode = MODE_ORDER.map((mode) => {
    const group = machines.filter((machine) => machine.failed && (mode ? machine.modes.includes(mode) : machine.modes.length === 0));
    return { mode, total: group.length, caught: group.filter((machine) => machine.probability >= threshold).length };
  }).filter((row) => row.total > 0);

  const mistakes = machines
    .filter((machine) => (tab === "missed" ? machine.failed && machine.probability < threshold : !machine.failed && machine.probability >= threshold))
    .sort((a, b) => (tab === "missed" ? b.probability - a.probability : a.probability - b.probability));
  const shown = mistakes.slice(0, 20).map((machine) => {
    const explanation = explainInputs(machine.inputs, model);
    return { ...machine, explanation, driver: explanation.reasons.find((reason) => reason.points > 0) };
  });

  return (
    <section className="fleet-panel performance-panel">
      <div className="fleet-intro">
        <div>
          <p className="eyebrow">Model performance · 1,500 held-out machines</p>
          <h2>How good is the failure model?</h2>
          <p>These machines were sealed away until the model and threshold were frozen. {failures} of them really failed. Change the decision policy above and every number here updates.</p>
        </div>
      </div>

      <div className="perf-top">
        <div className="confusion" role="table" aria-label="Decisions against what really happened">
          <div role="row" className="confusion-head"><span role="columnheader"><span className="sr-only">Outcome</span></span><span role="columnheader">Flagged for review</span><span role="columnheader">Not flagged</span></div>
          <div role="row"><span role="rowheader">Really failed</span>
            <div role="cell" className="cell good"><strong>{counts.tp}</strong><small>caught</small></div>
            <div role="cell" className="cell bad"><strong>{counts.fn}</strong><small>missed</small></div>
          </div>
          <div role="row"><span role="rowheader">Did not fail</span>
            <div role="cell" className="cell warn"><strong>{counts.fp}</strong><small>false alarms</small></div>
            <div role="cell" className="cell good"><strong>{counts.tn.toLocaleString("en-IN")}</strong><small>correctly cleared</small></div>
          </div>
        </div>
        <div className="perf-statements">
          <p><strong>{pct(recall)}</strong> of real failures are caught: {counts.tp} of {failures}. <InfoTip term="recall" /></p>
          <p><strong>{pct(precision)}</strong> of flags are real failures. <InfoTip term="precision" /></p>
          <p className="perf-note">Lower the threshold and you catch more failures but raise more false alarms. The chart shows that trade-off at every threshold.</p>
        </div>
      </div>

      <div className="perf-grid">
        <article className="insight-card">
          <p className="eyebrow">The trade-off</p><h3>Every threshold, on the test set</h3>
          <TradeoffChart machines={machines} threshold={threshold} />
        </article>
        <article className="insight-card">
          <p className="eyebrow">What it catches</p><h3>Failures caught, by type</h3>
          <ul className="mode-list">
            {byMode.map((row) => (
              <li key={row.mode || "none"}>
                <span>{MODE_LABELS[row.mode]}<strong>{row.caught} of {row.total}</strong></span>
                <i><b style={{ width: `${(row.caught / row.total) * 100}%` }} /></i>
              </li>
            ))}
          </ul>
          <p className="card-note">Power, overstrain and overheating follow fixed rules, and the model learned them. Tool-wear failures happen at a random point between 200 and 240 minutes, so no model can time them from one reading.</p>
        </article>
      </div>

      <div className="mistakes">
        <div className="priority-heading">
          <div><p className="eyebrow">Learn from the errors</p><h3>The model's mistakes</h3></div>
          <div className="band-filter" role="group" aria-label="Mistake type">
            <button type="button" className={tab === "missed" ? "active" : ""} onClick={() => { setTab("missed"); setExpanded(null); }}>Missed failures {counts.fn}</button>
            <button type="button" className={tab === "false" ? "active" : ""} onClick={() => { setTab("false"); setExpanded(null); }}>False alarms {counts.fp}</button>
          </div>
        </div>
        {shown.length === 0 ? <p className="empty-copy">None at this threshold.</p> : (
          <div className="table-scroll">
            <table className="priority-table">
              <thead><tr><th>Machine</th><th>Type</th><th>Score</th><th>{tab === "missed" ? "Failure type" : "Outcome"}</th><th>Main driver</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{shown.map((machine) => (
                <Fragment key={machine.id}>
                  <tr className={expanded === machine.id ? "expanded" : ""}>
                    <td><strong>Test #{machine.id}</strong></td><td>{machine.inputs.type}</td><td>{pct(machine.probability)}</td>
                    <td>{tab === "missed" ? (machine.modes.length ? machine.modes.map((mode) => MODE_LABELS[mode]).join(" + ") : MODE_LABELS[""]) : "Did not fail"}</td>
                    <td className="driver-cell">{machine.driver ? <>{machine.driver.label} <small>{machine.driver.value}</small></> : "—"}</td>
                    <td className="row-actions">
                      <button type="button" aria-expanded={expanded === machine.id} onClick={() => setExpanded((current) => (current === machine.id ? null : machine.id))}>
                        {expanded === machine.id ? "Hide" : "Why?"}
                      </button>
                      <button type="button" onClick={() => onOpenMachine(machine.inputs)}>Open</button>
                    </td>
                  </tr>
                  {expanded === machine.id && (
                    <tr className="why-row"><td colSpan={6}><WhyScore explanation={machine.explanation} probability={machine.probability} limit={3} /></td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
        {mistakes.length > shown.length && <p className="invalid-note">Showing the 20 {tab === "missed" ? "closest misses" : "least confident false alarms"} of {mistakes.length}.</p>}
      </div>

      <div className="method-columns evidence">
        <div>
          <strong>Ranking quality</strong>
          <p>PR-AUC <b>{summary.prAuc.toFixed(3)}</b> (95% range {summary.prAuc95ci[0].toFixed(3)}–{summary.prAuc95ci[1].toFixed(3)}). Random guessing would score about {(failures / machines.length).toFixed(3)}. <InfoTip term="prAuc" /></p>
        </div>
        <div>
          <strong>Against the rulebook</strong>
          <p>The dataset's own failure formulas score F1 <b>{summary.rulesF1.toFixed(3)}</b>; the model scores <b>{summary.modelF1.toFixed(3)}</b> at the frozen threshold. It nearly matches rules it was never shown, but real machines have no rulebook.</p>
        </div>
        <div>
          <strong>Can you trust the %?</strong>
          <p>Brier score <b>{summary.brier.toFixed(4)}</b> against {summary.brierBaseRate.toFixed(4)} for always guessing the failure rate. Scores near 0% and 100% are reliable; the few between 20% and 60% are rougher. <InfoTip term="brier" /></p>
        </div>
      </div>
    </section>
  );
}
