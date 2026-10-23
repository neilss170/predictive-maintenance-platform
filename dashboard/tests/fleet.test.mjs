import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCsv, validateFleetCsv } from "../src/fleet.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = readFileSync(path.join(root, "public", "sample-fleet.csv"), "utf8");
const mockScore = () => ({
  probability: 0.25,
  flagged: true,
  risk: { label: "High", className: "high" },
});

test("parses the generated 600-row fleet sample", () => {
  const parsed = parseCsv(sample);
  assert.equal(parsed.records.length, 600);
  assert.equal(parsed.headers.length, 7);
});

test("validates all generated sample rows", () => {
  const result = validateFleetCsv(sample, mockScore);
  assert.equal(result.totalRows, 600);
  assert.equal(result.valid.length, 600);
  assert.equal(result.invalid.length, 0);
});

test("rejects leakage columns", () => {
  const text = sample.replace("Machine ID,Type", "Machine ID,Machine failure,Type")
    .replace("SYN-0001,L", "SYN-0001,0,L");
  assert.throws(() => validateFleetCsv(text, mockScore), /leakage columns/);
});

test("separates malformed and duplicate rows", () => {
  const text = [
    "Machine ID,Type,Air temperature [K],Process temperature [K],Rotational speed [rpm],Torque [Nm],Tool wear [min]",
    "M-1,L,298.1,308.6,1551,42.8,0",
    "M-1,X,500,308.6,bad,42.8,0",
  ].join("\n");
  const result = validateFleetCsv(text, mockScore);
  assert.equal(result.valid.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.ok(result.invalid[0].errors.length >= 3);
});

test("risk bands stay reachable at any threshold", async () => {
  const { riskLevel } = await import("../src/risk.js");
  for (const threshold of [0.016, 0.2, 0.483, 0.9]) {
    const labels = [0, threshold * 0.75, threshold + 0.001, 0.9999].map((p) => riskLevel(p, threshold).label);
    assert.deepEqual(labels, ["Low", "Watch", "High", "Critical"], `threshold ${threshold}`);
  }
});

test("cost policy picks the curve row for a ratio and clamps out-of-range ratios", async () => {
  const { policyForRatio, testCost } = await import("../src/risk.js");
  const curve = JSON.parse(readFileSync(path.join(root, "public/cost-curve.json"), "utf-8"));
  assert.equal(policyForRatio(curve, 20).ratio, 20);
  assert.equal(policyForRatio(curve, 0).ratio, 1);
  assert.equal(policyForRatio(curve, 500).ratio, 100);
  const row = policyForRatio(curve, 20);
  assert.equal(testCost(row, 20), row.test_cost);
  assert.ok(curve.frozen.missed_failures + curve.frozen.flagged > 0);
});

test("rupee costs map to a clamped cost ratio and a per-1,000 cost", async () => {
  const { costPer1000, costRatio } = await import("../src/risk.js");
  assert.equal(costRatio(50000, 2000), 25);
  assert.equal(costRatio(1000, 2000), 1);
  assert.equal(costRatio(5000000, 2000), 100);
  assert.equal(costRatio(50000, 0), 100);
  const policy = { missed_failures: 4, false_alarms: 2 };
  assert.equal(costPer1000(policy, 50000, 2000, 1500), ((4 * 50000 + 2 * 2000) / 1500) * 1000);
});

test("band explanations cover exactly the bands riskLevel assigns", async () => {
  const { riskLevel, riskMeanings } = await import("../src/risk.js");
  const labels = [0, 0.3, 0.6, 0.99].map((p) => riskLevel(p, 0.483).label);
  assert.deepEqual(Object.keys(riskMeanings(0.483)), labels);
});
