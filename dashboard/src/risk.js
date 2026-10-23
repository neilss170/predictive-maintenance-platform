// Risk bands relative to the active decision threshold. "High" and "Critical"
// split the range above the threshold, so every band stays reachable whatever
// threshold the cost policy picks.
export function riskLevel(probability, threshold) {
  if (probability < threshold * 0.5) return { label: "Low", className: "low" };
  if (probability < threshold) return { label: "Watch", className: "watch" };
  if (probability < threshold + (1 - threshold) / 2) return { label: "High", className: "high" };
  return { label: "Critical", className: "critical" };
}

// The cost curve holds one row per integer cost ratio, each with the threshold
// chosen on out-of-fold development predictions and its held-out test outcome.
export function policyForRatio(curve, ratio) {
  const rows = curve.ratios;
  const clamped = Math.min(Math.max(Math.round(ratio), rows[0].ratio), rows.at(-1).ratio);
  return rows.find((row) => row.ratio === clamped);
}

export function testCost(policy, ratio) {
  return ratio * policy.missed_failures + policy.false_alarms;
}
