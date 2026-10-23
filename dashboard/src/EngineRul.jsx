import { useEffect, useMemo, useState } from "react";
import { InfoTip } from "./InfoTip.jsx";
import { BAND_LABELS, bandClass, bandFor, bandMeaning, bandPath, countBands, linePath, rulRange, summarizeEngines } from "./rulFleet.js";

const CHART = { width: 720, height: 300, left: 44, right: 16, top: 16, bottom: 34 };
const SENSORS = [
  { key: "sensor_4", label: "Sensor 4 · LPT outlet temperature" },
  { key: "sensor_11", label: "Sensor 11 · HPC static pressure" },
  { key: "sensor_15", label: "Sensor 15 · bypass ratio" },
];

function Summary({ label, value, tone = "", term }) {
  return <div className={`fleet-summary ${tone}`}><span>{label}{term && <InfoTip term={term} />}</span><strong>{value}</strong></div>;
}

function RulChart({ engine, cursor, rulCap, riskBands, interval }) {
  const lastCycle = engine.cycles[engine.cycles.length - 1];
  const yMax = Math.max(rulCap + 20, Math.min(engine.actual[0], 260));
  const innerW = CHART.width - CHART.left - CHART.right;
  const innerH = CHART.height - CHART.top - CHART.bottom;
  const scale = {
    yMax,
    x: (cycle) => CHART.left + ((cycle - 1) / Math.max(lastCycle - 1, 1)) * innerW,
    y: (rul) => CHART.top + (1 - rul / yMax) * innerH,
  };
  const ticks = [0, riskBands.severe, riskBands.warning, rulCap].filter((tick) => tick <= yMax);
  const cursorX = scale.x(engine.cycles[cursor]);

  return (
    <svg className="rul-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img"
      aria-label={`Predicted and true remaining useful life for engine ${engine.unit}`}>
      <rect className="band severe" x={CHART.left} width={innerW} y={scale.y(riskBands.severe)} height={scale.y(0) - scale.y(riskBands.severe)} />
      <rect className="band warning" x={CHART.left} width={innerW} y={scale.y(riskBands.warning)} height={scale.y(riskBands.severe) - scale.y(riskBands.warning)} />
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="grid" x1={CHART.left} x2={CHART.width - CHART.right} y1={scale.y(tick)} y2={scale.y(tick)} />
          <text className="axis" x={CHART.left - 8} y={scale.y(tick) + 4} textAnchor="end">{tick}</text>
        </g>
      ))}
      <text className="axis" x={CHART.left} y={CHART.height - 8}>cycle 1</text>
      <text className="axis" x={CHART.width - CHART.right} y={CHART.height - 8} textAnchor="end">cycle {lastCycle}</text>
      {interval && <path className="range" d={bandPath(engine.cycles.slice(0, cursor + 1), engine.predicted.slice(0, cursor + 1), interval, scale)} />}
      <path className="series actual" d={linePath(engine.cycles, engine.actual, scale)} />
      <path className="series predicted" d={linePath(engine.cycles.slice(0, cursor + 1), engine.predicted.slice(0, cursor + 1), scale)} />
      <line className="cursor" x1={cursorX} x2={cursorX} y1={CHART.top} y2={CHART.top + innerH} />
      <circle className="cursor-dot" cx={cursorX} cy={scale.y(Math.min(engine.predicted[cursor], yMax))} r="4.5" />
    </svg>
  );
}

function Sparkline({ values, cursor }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) =>
    `${((index / Math.max(values.length - 1, 1)) * 200).toFixed(1)},${(38 - ((value - min) / span) * 34).toFixed(1)}`);
  const [cx, cy] = points[cursor].split(",");
  return (
    <svg className="sparkline" viewBox="0 0 200 42" aria-hidden="true">
      <polyline points={points.join(" ")} />
      <circle cx={cx} cy={cy} r="3" />
    </svg>
  );
}

export function EngineRul() {
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState(null);
  const [rawCursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bandFilter, setBandFilter] = useState("all");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}rul-fleet.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Turbofan fleet data could not be loaded.");
        return response.json();
      })
      .then(setFleet)
      .catch((reason) => setError(reason.message));
  }, []);

  const summaries = useMemo(() => (fleet ? summarizeEngines(fleet) : []), [fleet]);
  const counts = useMemo(() => countBands(summaries), [summaries]);
  const engine = fleet?.engines.find((item) => item.unit === (unit ?? summaries[0]?.unit));
  const lastIndex = engine ? engine.cycles.length - 1 : 0;

  useEffect(() => {
    setCursor(lastIndex);
    setPlaying(false);
  }, [engine?.unit, lastIndex]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setCursor((current) => {
        if (current >= lastIndex) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 60);
    return () => clearInterval(timer);
  }, [playing, lastIndex]);

  if (error) return <div className="fleet-loading">{error}</div>;
  if (!fleet || !engine) return <div className="fleet-loading">Loading turbofan fleet...</div>;

  const { metrics, riskBands, rulCap } = fleet;
  // The cursor resets after render when the engine changes; clamp until then.
  const cursor = Math.min(rawCursor, lastIndex);
  const predicted = engine.predicted[cursor];
  const actual = engine.actual[cursor];
  const band = bandFor(predicted, riskBands);
  const range = metrics.interval ? rulRange(predicted, metrics.interval) : null;
  const visible = summaries.filter((row) => bandFilter === "all" || row.band === bandFilter);

  function play() {
    if (rawCursor >= lastIndex) setCursor(0);
    setPlaying(true);
  }

  return (
    <section className="fleet-panel rul-panel">
      <div className="fleet-intro">
        <div>
          <p className="eyebrow">Remaining useful life · NASA C-MAPSS FD001</p>
          <h2>How many cycles does each engine have left?</h2>
          <p>
            These are the 100 official test engines. Their records stop before failure, and the model never saw them during
            training or model selection. Replay any engine cycle by cycle to watch the forecast converge as wear accumulates.
          </p>
        </div>
      </div>

      <div className="fleet-summaries">
        <Summary label="Test RMSE (cycles)" value={`${metrics.rmse.toFixed(1)}`} term="rmse" />
        <Summary label="RMSE 95% interval" value={`${metrics.rmse_95ci[0].toFixed(1)}–${metrics.rmse_95ci[1].toFixed(1)}`} term="interval" />
        <Summary label={`≤${metrics.alarm.alarm_cycles}-cycle alarm recall`} value={`${Math.round(metrics.alarm.recall * 100)}%`} tone="warning" term="alarmRecall" />
        <Summary label="Alarm precision" value={`${Math.round(metrics.alarm.precision * 100)}%`} tone="critical" term="alarmPrecision" />
        {metrics.interval && <Summary label={`${Math.round(metrics.interval.level * 100)}% range hit rate`} value={`${Math.round(metrics.interval.test_coverage * 100)}%`} term="rulRange" />}
      </div>

      <div className="rul-layout">
        <div className="rul-detail">
          <div className="rul-detail-head">
            <div>
              <p className="eyebrow">Engine {engine.unit}</p>
              <h3>Cycle {engine.cycles[cursor]} of {engine.cycles[lastIndex]} observed</h3>
            </div>
            <span className={`table-risk ${bandClass(band)}`}>{BAND_LABELS[band]} <InfoTip label={`What ${BAND_LABELS[band]} means`} text={bandMeaning(band, riskBands)} /></span>
          </div>

          <div className="rul-readout">
            <div><span>Predicted RUL</span><strong>{predicted.toFixed(0)}</strong><small>{range ? <>likely {range.low.toFixed(0)}–{range.high.toFixed(0)} cycles <InfoTip term="rulRange" /></> : "cycles"}</small></div>
            <div><span>True RUL</span><strong>{actual}</strong><small>cycles</small></div>
            <div><span>Error</span><strong className={predicted - actual > 0 ? "worsened" : "improved"}>{predicted - actual > 0 ? "+" : ""}{(predicted - actual).toFixed(0)}</strong><small>{predicted - actual > 0 ? "late (riskier)" : "early (safer)"}</small></div>
          </div>

          <RulChart engine={engine} cursor={cursor} rulCap={rulCap} riskBands={riskBands} interval={metrics.interval} />
          <div className="rul-legend">
            <span><i className="predicted" />Predicted</span>
            <span><i className="actual" />True RUL</span>
            {metrics.interval && <span><i className="range" />Likely range ({Math.round(metrics.interval.level * 100)}%)</span>}
            <span><i className="warning" />Warning ≤{riskBands.warning}</span>
            <span><i className="severe" />Severe ≤{riskBands.severe}</span>
          </div>

          <div className="rul-controls">
            <button className="secondary-button" type="button" onClick={() => (playing ? setPlaying(false) : play())}>{playing ? "Pause" : "Replay engine"}</button>
            <input className="range-input" type="range" min="0" max={lastIndex} value={cursor}
              aria-label="Cycle" onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} />
          </div>
          <p className="card-note">
            The model is trained on a target capped at {rulCap} cycles, so early in life it reports "at least {rulCap}". The forecast
            only becomes informative once degradation shows in the sensors.
          </p>

          <div className="sensor-grid">
            {SENSORS.map(({ key, label }) => (
              <div className="sensor-card" key={key}>
                <span>{label}</span>
                <strong>{engine.sensors[key][cursor]}</strong>
                <Sparkline values={engine.sensors[key]} cursor={cursor} />
              </div>
            ))}
          </div>
        </div>

        <div className="rul-list">
          <div className="priority-heading">
            <div><p className="eyebrow">Maintenance queue</p><h3>Engines by predicted RUL</h3></div>
          </div>
          <div className="band-filter" role="group" aria-label="Filter by risk band">
            {["all", "severe", "warning", "healthy"].map((key) => (
              <button key={key} type="button" className={bandFilter === key ? "active" : ""} onClick={() => setBandFilter(key)}>
                {key === "all" ? `All ${summaries.length}` : `${BAND_LABELS[key]} ${counts[key]}`}
              </button>
            ))}
          </div>
          <div className="table-scroll rul-table-scroll">
            <table className="priority-table">
              <thead><tr><th>Engine</th><th>Pred.</th><th>True</th><th>Band</th></tr></thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.unit} className={row.unit === engine.unit ? "selected" : ""} onClick={() => setUnit(row.unit)}>
                    <td><strong>#{row.unit}</strong></td>
                    <td>{row.predicted.toFixed(0)}</td>
                    <td>{row.actual}</td>
                    <td><span className={`table-risk ${bandClass(row.band)}`}>{BAND_LABELS[row.band]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
