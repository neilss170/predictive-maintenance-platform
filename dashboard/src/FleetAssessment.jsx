import { Fragment, useMemo, useState } from "react";
import { WhyScore } from "./Explain.jsx";
import { invalidToCsv, resultsToCsv, validateFleetCsv } from "./fleet.js";
import { InfoTip } from "./InfoTip.jsx";
import { riskLevel, riskMeanings } from "./risk.js";

const PAGE_SIZE = 25;

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Summary({ label, value, tone = "" }) {
  return <div className={`fleet-summary ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function FleetAssessment({ threshold, scoreInputs, explain, onOpenMachine }) {
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sortDirection, setSortDirection] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  async function handleFile(file) {
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Choose a CSV file.");
    if (file.size > 2_000_000) return setError("The CSV must be smaller than 2 MB.");
    try {
      const result = validateFleetCsv(await file.text(), scoreInputs);
      setFleet(result);
      setFilename(file.name);
      setPage(1);
    } catch (reason) {
      setFleet(null);
      setError(reason.message);
    }
  }

  // Probabilities are scored once on upload; decisions follow the active threshold.
  const rows = useMemo(() => (fleet?.valid || []).map((row) => ({
    ...row, flagged: row.probability >= threshold, risk: riskLevel(row.probability, threshold),
  })), [fleet, threshold]);

  const filtered = useMemo(() => {
    if (!fleet) return [];
    return rows
      .filter((row) => row.machineId.toLowerCase().includes(search.toLowerCase()))
      .filter((row) => riskFilter === "All" || row.risk.label === riskFilter)
      .filter((row) => !flaggedOnly || row.flagged)
      .sort((a, b) => sortDirection === "desc" ? b.probability - a.probability : a.probability - b.probability);
  }, [fleet, rows, search, riskFilter, flaggedOnly, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Explanations only for the rows on screen: each costs about one forest pass.
  const visibleRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => {
    const explanation = explain(row.inputs);
    const driver = explanation.reasons.find((reason) => reason.points > 0);
    return { ...row, explanation, driver };
  }), [filtered, page, explain]);
  const counts = rows.reduce((summary, row) => {
    summary[row.risk.label] = (summary[row.risk.label] || 0) + 1;
    return summary;
  }, {});
  const averageRisk = rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : 0;
  const flagged = rows.filter((row) => row.flagged).length;

  function resetFilters() {
    setSearch(""); setRiskFilter("All"); setFlaggedOnly(false); setPage(1);
  }

  return (
    <section className="fleet-panel">
      <div className="fleet-intro">
        <div><p className="eyebrow">Fleet assessment</p><h2>Score and prioritize multiple machines</h2><p>Upload leakage-free operating observations. Processing stays in your browser and Machine ID is never passed to the model.</p></div>
        <a className="sample-link" href={`${import.meta.env.BASE_URL}sample-fleet.csv`} download>Download sample CSV</a>
      </div>

      <label className="drop-zone">
        <input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} />
        <span className="upload-icon">CSV</span>
        <strong>{filename || "Choose a fleet CSV"}</strong>
        <small>Up to 5,000 rows and 2 MB</small>
      </label>
      {error && <div className="upload-error" role="alert"><strong>File could not be scored</strong><p>{error}</p></div>}

      {fleet && (
        <>
          <div className="fleet-summaries">
            <Summary label="Uploaded rows" value={fleet.totalRows} />
            <Summary label="Valid machines" value={fleet.valid.length} />
            <Summary label="Needs review" value={flagged} tone="warning" />
            <Summary label="Critical risk" value={counts.Critical || 0} tone="critical" />
            <Summary label="Average risk" value={`${(averageRisk * 100).toFixed(1)}%`} />
            <Summary label="Invalid rows" value={fleet.invalid.length} tone={fleet.invalid.length ? "warning" : ""} />
          </div>

          <div className="risk-distribution" aria-label="Fleet risk distribution">
            {["Low", "Watch", "High", "Critical"].map((level) => (
              <div key={level}><span>{level}<strong>{counts[level] || 0}</strong></span><i><b className={level.toLowerCase()} style={{ width: `${fleet.valid.length ? ((counts[level] || 0) / fleet.valid.length) * 100 : 0}%` }} /></i></div>
            ))}
          </div>

          <div className="table-toolbar">
            <input aria-label="Search machine ID" placeholder="Search machine ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select aria-label="Filter by risk" value={riskFilter} onChange={(event) => { setRiskFilter(event.target.value); setPage(1); }}>
              {["All", "Low", "Watch", "High", "Critical"].map((level) => <option key={level}>{level}</option>)}
            </select>
            <label className="check-filter"><input type="checkbox" checked={flaggedOnly} onChange={(event) => { setFlaggedOnly(event.target.checked); setPage(1); }} /> Review only</label>
            <button type="button" onClick={() => setSortDirection((value) => value === "desc" ? "asc" : "desc")}>Risk {sortDirection === "desc" ? "↓" : "↑"}</button>
            <button type="button" onClick={resetFilters}>Reset filters</button>
          </div>

          <div className="priority-heading">
            <div><p className="eyebrow">Maintenance priority</p><h2>{filtered.length} matching machines</h2></div>
            <div className="inline-actions">
              <button className="text-button" type="button" disabled={!filtered.length} onClick={() => downloadText(resultsToCsv(filtered), "fleet-scored-results.csv")}>Export filtered</button>
              {fleet.invalid.length > 0 && <button className="text-button danger" type="button" onClick={() => downloadText(invalidToCsv(fleet.invalid), "fleet-invalid-rows.csv")}>Export errors</button>}
            </div>
          </div>

          <div className="table-scroll">
            <table className="priority-table">
              <thead><tr><th>Machine</th><th>Type</th><th>Risk</th><th>Level <InfoTip label="What the levels mean" text={Object.entries(riskMeanings(threshold)).map(([level, meaning]) => `${level}: ${meaning}`).join("\n")} /></th><th>Main driver</th><th>Decision</th><th /></tr></thead>
              <tbody>{visibleRows.map((row) => (
                <Fragment key={row.machineId}>
                  <tr className={expanded === row.machineId ? "expanded" : ""}>
                    <td><strong>{row.machineId}</strong></td><td>{row.inputs.type}</td><td>{(row.probability * 100).toFixed(1)}%</td>
                    <td><span className={`table-risk ${row.risk.className}`}>{row.risk.label}</span></td>
                    <td className="driver-cell">{row.driver ? <>{row.driver.label} <small>{row.driver.value}</small></> : "—"}</td>
                    <td>{row.flagged ? "Review" : "Monitor"}</td>
                    <td className="row-actions">
                      <button type="button" aria-expanded={expanded === row.machineId}
                        onClick={() => setExpanded((current) => (current === row.machineId ? null : row.machineId))}>
                        {expanded === row.machineId ? "Hide" : "Why?"}
                      </button>
                      <button type="button" onClick={() => onOpenMachine(row.inputs)}>Open</button>
                    </td>
                  </tr>
                  {expanded === row.machineId && (
                    <tr className="why-row"><td colSpan={7}>
                      <WhyScore explanation={row.explanation} probability={row.probability} limit={3} />
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
          <div className="pagination"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>
          {fleet.invalid.length > 0 && <p className="invalid-note">{fleet.invalid.length} rows were excluded from scoring. Export the error report to review them.</p>}
        </>
      )}
    </section>
  );
}
