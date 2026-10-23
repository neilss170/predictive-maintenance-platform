import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bandFor, countBands, linePath, summarizeEngines } from "../src/rulFleet.js";

const fleet = JSON.parse(readFileSync(new URL("../public/rul-fleet.json", import.meta.url), "utf-8"));
const bands = { severe: 30, warning: 70 };

test("risk bands include their upper bound", () => {
  assert.equal(bandFor(30, bands), "severe");
  assert.equal(bandFor(30.1, bands), "warning");
  assert.equal(bandFor(70, bands), "warning");
  assert.equal(bandFor(71, bands), "healthy");
});

test("exported fleet covers the 100 official test engines", () => {
  assert.equal(fleet.engines.length, 100);
  for (const engine of fleet.engines) {
    assert.equal(engine.cycles.length, engine.predicted.length);
    assert.equal(engine.cycles.length, engine.actual.length);
    assert.ok(engine.predicted.every((value) => value >= 0 && value <= fleet.rulCap));
  }
});

test("exported metrics agree with the per-engine predictions", () => {
  const summaries = summarizeEngines(fleet);
  const rmse = Math.sqrt(summaries.reduce((sum, row) => sum + row.error ** 2, 0) / summaries.length);
  assert.ok(Math.abs(rmse - fleet.metrics.rmse) < 0.05, `${rmse} vs ${fleet.metrics.rmse}`);
});

test("summaries are ordered most urgent first and counted by band", () => {
  const summaries = summarizeEngines(fleet);
  for (let index = 1; index < summaries.length; index += 1) {
    assert.ok(summaries[index - 1].predicted <= summaries[index].predicted);
  }
  const counts = countBands(summaries);
  assert.equal(counts.severe + counts.warning + counts.healthy, 100);
});

test("line paths clamp values to the chart ceiling", () => {
  const scale = { yMax: 100, x: (cycle) => cycle, y: (rul) => 100 - rul };
  assert.equal(linePath([1, 2], [50, 400], scale), "M1.0,50.0L2.0,0.0");
});

test("likely range brackets the forecast and widens for healthier engines", async () => {
  const { rulRange } = await import("../src/rulFleet.js");
  const { interval } = fleet.metrics;
  assert.equal(interval.level, 0.8);
  const near = rulRange(10, interval);
  const far = rulRange(120, interval);
  assert.ok(near.low <= 10 && near.high >= 10);
  assert.ok(near.low >= 0);
  assert.ok(far.high - far.low > near.high - near.low);
  // On the official test engines the range held the truth at least as often as promised.
  assert.ok(interval.test_coverage >= 0.8);
});
