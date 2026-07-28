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
