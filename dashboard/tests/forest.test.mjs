import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateResult, explainInputs, ruleStatus, SCENARIOS, thresholdCrossings } from "../src/forest.js";

const model = JSON.parse(readFileSync(new URL("../public/model.json", import.meta.url), "utf-8"));
const threshold = model.decisionThreshold;
const byKey = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.key, scenario.inputs]));

test("reasons add up exactly to the predicted probability", () => {
  for (const scenario of SCENARIOS) {
    const { probability } = calculateResult(scenario.inputs, model, threshold);
    const { baseline, reasons } = explainInputs(scenario.inputs, model);
    const total = baseline + reasons.reduce((sum, reason) => sum + reason.points, 0);
    assert.ok(Math.abs(total - probability * 100) < 1e-6, scenario.key);
  }
});

test("the top reason matches the failure each scenario demonstrates", () => {
  const top = (key) => explainInputs(byKey[key], model).reasons[0].key;
  assert.equal(top("power"), "Mechanical power [W]");
  assert.equal(top("strain"), "Torque × tool wear");
  assert.equal(top("wear"), "Tool wear [min]");
  assert.ok(["Rotational speed [rpm]", "Temperature difference [K]"].includes(top("heat")));
});

test("scenarios land on the expected side of the frozen threshold", () => {
  const flagged = (key) => calculateResult(byKey[key], model, threshold).flagged;
  assert.equal(flagged("healthy"), false);
  for (const key of ["heat", "power", "strain"]) assert.equal(flagged(key), true, key);
  // Tool-wear failures are random in the data; the model rarely flags them.
  assert.equal(flagged("wear"), false);
});

test("every suggested change really crosses the threshold", () => {
  for (const scenario of SCENARIOS) {
    const { flagged, moves } = thresholdCrossings(scenario.inputs, model, threshold);
    for (const move of moves) {
      const after = calculateResult({ ...scenario.inputs, [move.name]: move.to }, model, threshold);
      assert.notEqual(after.flagged, flagged, `${scenario.key} ${move.name}`);
      assert.ok(move.to >= move.min && move.to <= move.max);
    }
  }
});

test("controllable readings are suggested before environmental ones", () => {
  const { moves } = thresholdCrossings(byKey.heat, model, threshold);
  const firstEnvironment = moves.findIndex((move) => !move.actionable);
  const lastActionable = moves.map((move) => move.actionable).lastIndexOf(true);
  assert.ok(firstEnvironment === -1 || lastActionable < firstEnvironment);
});

test("rule status flags the documented failure conditions", () => {
  const status = (key) => Object.fromEntries(ruleStatus(byKey[key]).map((rule) => [rule.key, rule.status]));
  assert.equal(status("heat").heat, "triggered");
  assert.equal(status("power").power, "triggered");
  assert.equal(status("strain").strain, "triggered");
  assert.equal(status("wear").wear, "triggered");
  assert.ok(Object.values(status("healthy")).every((value) => value !== "triggered"));
});

test("browser decisions on the test set match the Python evaluation report", async () => {
  const { confusion, machinesFrom } = await import("../src/performance.js");
  const data = JSON.parse(readFileSync(new URL("../public/test-machines.json", import.meta.url), "utf-8"));
  const machines = machinesFrom(data).map((machine) => ({ ...machine, probability: calculateResult(machine.inputs, model, 0).probability }));
  assert.deepEqual(confusion(machines, threshold), { tp: 45, fn: 6, fp: 2, tn: 1447 });
});

test("ideal ranges flag the readings that break a rule, and fixing one clears it", async () => {
  const { idealRanges, isIdeal } = await import("../src/forest.js");
  const outside = (inputs) => Object.entries(idealRanges(inputs)).filter(([name, range]) => !isIdeal(inputs[name], range)).map(([name]) => name);
  assert.deepEqual(outside(byKey.healthy), []);
  assert.ok(outside(byKey.power).includes("torque"));
  assert.ok(outside(byKey.strain).includes("toolWear"));
  const { torque } = idealRanges(byKey.power);
  const fixed = { ...byKey.power, torque: (torque.min + torque.max) / 2 };
  assert.equal(ruleStatus(fixed).find((rule) => rule.key === "power").status !== "triggered", true);
});
