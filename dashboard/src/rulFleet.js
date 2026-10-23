export const BAND_LABELS = { severe: "Severe", warning: "Warning", healthy: "Healthy" };
const BAND_CLASSES = { severe: "critical", warning: "watch", healthy: "low" };

export function bandFor(predictedRul, riskBands) {
  if (predictedRul <= riskBands.severe) return "severe";
  if (predictedRul <= riskBands.warning) return "warning";
  return "healthy";
}

export function bandClass(band) {
  return BAND_CLASSES[band];
}

/** Latest-cycle view of each engine, most urgent first. */
export function summarizeEngines(fleet) {
  return fleet.engines
    .map((engine) => {
      const last = engine.cycles.length - 1;
      const predicted = engine.predicted[last];
      const actual = engine.actual[last];
      return {
        unit: engine.unit,
        cyclesObserved: engine.cycles[last],
        predicted,
        actual,
        error: predicted - actual,
        band: bandFor(predicted, fleet.riskBands),
      };
    })
    .sort((a, b) => a.predicted - b.predicted || a.unit - b.unit);
}

export function countBands(summaries) {
  return summaries.reduce(
    (counts, row) => ({ ...counts, [row.band]: counts[row.band] + 1 }),
    { severe: 0, warning: 0, healthy: 0 },
  );
}

/** SVG path for a series, mapping cycle and RUL into a width x height box. */
export function linePath(cycles, values, scale) {
  return cycles
    .map((cycle, index) => {
      const x = scale.x(cycle);
      const y = scale.y(Math.min(values[index], scale.yMax));
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
}
