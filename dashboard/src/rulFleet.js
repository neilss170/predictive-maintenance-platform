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

function interpolate(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs.at(-1)) return ys.at(-1);
  const i = xs.findIndex((value) => value >= x);
  const share = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + share * (ys[i] - ys[i - 1]);
}

/** Likely range for a forecast: out-of-fold error offsets, interpolated between bucket centres (matches rul/train.py). */
export function rulRange(predicted, interval) {
  const { buckets } = interval;
  const centres = buckets.map((bucket, i) => ((i ? buckets[i - 1].up_to : 0) + bucket.up_to) / 2);
  const low = interpolate(predicted, centres, buckets.map((bucket) => bucket.low));
  const high = interpolate(predicted, centres, buckets.map((bucket) => bucket.high));
  return { low: Math.max(predicted + low, 0), high: predicted + high };
}

/** Closed SVG path for the range band around a forecast series. */
export function bandPath(cycles, predicted, interval, scale) {
  const ranges = predicted.map((value) => rulRange(value, interval));
  const top = cycles.map((cycle, i) => `${i ? "L" : "M"}${scale.x(cycle).toFixed(1)},${scale.y(Math.min(ranges[i].high, scale.yMax)).toFixed(1)}`);
  const bottom = cycles.map((cycle, i) => `L${scale.x(cycle).toFixed(1)},${scale.y(Math.min(ranges[i].low, scale.yMax)).toFixed(1)}`).reverse();
  return `${top.join("")}${bottom.join("")}Z`;
}
