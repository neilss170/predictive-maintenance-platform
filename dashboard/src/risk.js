// Risk bands relative to the active decision threshold. "High" and "Critical"
// split the range above the threshold, so every band stays reachable whatever
// threshold the cost policy picks.
export function riskLevel(probability, threshold) {
  if (probability < threshold * 0.5) return { label: "Low", className: "low" };
  if (probability < threshold) return { label: "Watch", className: "watch" };
  if (probability < criticalCut(threshold)) return { label: "High", className: "high" };
  return { label: "Critical", className: "critical" };
}

const criticalCut = (threshold) => threshold + (1 - threshold) / 2;
const pct = (value) => `${(value * 100).toFixed(1)}%`;

// What each band means at the active threshold, for the explanation tooltips.
export function riskMeanings(threshold) {
  return {
    Low: `Below ${pct(threshold / 2)}, under half the review threshold. Routine monitoring.`,
    Watch: `${pct(threshold / 2)}–${pct(threshold)}: below the review threshold but within reach. Recheck if readings drift.`,
    High: `${pct(threshold)}–${pct(criticalCut(threshold))}: over the review threshold, so it is sent for review.`,
    Critical: `${pct(criticalCut(threshold))} or more: the top half above the threshold. Review these first.`,
  };
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

// Rupee costs to the integer ratio the cost curve is indexed by (1-100).
export function costRatio(missCost, alarmCost) {
  const miss = Math.max(Number(missCost) || 0, 0);
  const alarm = Math.max(Number(alarmCost) || 0, 0);
  if (alarm === 0) return 100;
  return Math.min(Math.max(Math.round(miss / alarm), 1), 100);
}

// Expected cost per 1,000 machines, from the held-out test outcome of a policy.
export function costPer1000(policy, missCost, alarmCost, testRows) {
  const total = policy.missed_failures * Number(missCost) + policy.false_alarms * Number(alarmCost);
  return (total / testRows) * 1000;
}
