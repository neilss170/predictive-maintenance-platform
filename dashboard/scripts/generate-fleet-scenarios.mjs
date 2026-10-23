#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskLevel as sharedRiskLevel } from "../src/risk.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = JSON.parse(readFileSync(path.join(root, "public", "model.json"), "utf8"));

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function transform(row) {
  const temperatureDifference = row.processTemperature - row.airTemperature;
  const mechanicalPower = 2 * Math.PI * row.rotationalSpeed * row.torque / 60;
  const numeric = [
    row.airTemperature,
    row.processTemperature,
    row.rotationalSpeed,
    row.torque,
    row.toolWear,
    temperatureDifference,
    mechanicalPower,
    row.torque * row.toolWear,
  ];
  const standardized = numeric.map(
    (value, index) => Math.fround((value - model.means[index]) / model.scales[index]),
  );
  return [
    ...standardized,
    ...model.typeCategories.map((category) => category === row.type ? 1 : 0),
  ];
}

function score(row) {
  const vector = transform(row);
  let probability = 0;
  for (const tree of model.trees) {
    let node = 0;
    while (tree.l[node] !== -1) {
      node = vector[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
    }
    probability += tree.p[node];
  }
  return probability / model.trees.length;
}

function riskLevel(probability) {
  return sharedRiskLevel(probability, model.decisionThreshold).label;
}

const random = mulberry32(20260728);
const types = ["L", "M", "H"];
const candidates = [];

for (let index = 0; index < 5000; index += 1) {
  const airTemperature = 290 + random() * 20;
  const temperatureDelta = 7 + random() * 5;
  const row = {
    type: types[index % types.length],
    airTemperature: Number(airTemperature.toFixed(1)),
    processTemperature: Number(Math.max(300, Math.min(320, airTemperature + temperatureDelta)).toFixed(1)),
    rotationalSpeed: Math.round(1100 + random() * 1400),
    torque: Number((10 + random() * 65).toFixed(1)),
    toolWear: Math.round(random() * 250),
  };
  row.probability = score(row);
  row.riskLevel = riskLevel(row.probability);
  candidates.push(row);
}

const targetCounts = { Low: 240, Watch: 120, High: 140, Critical: 100 };
const selected = [];

for (const level of Object.keys(targetCounts)) {
  const group = candidates
    .filter((row) => row.riskLevel === level)
    .sort((a, b) => a.probability - b.probability);
  const count = Math.min(targetCounts[level], group.length);
  for (let index = 0; index < count; index += 1) {
    const position = count === 1 ? 0 : Math.round(index * (group.length - 1) / (count - 1));
    selected.push(group[position]);
  }
}

selected.sort((a, b) => {
  const typeOrder = types.indexOf(a.type) - types.indexOf(b.type);
  return typeOrder || a.probability - b.probability;
});

const header = [
  "Machine ID",
  "Type",
  "Air temperature [K]",
  "Process temperature [K]",
  "Rotational speed [rpm]",
  "Torque [Nm]",
  "Tool wear [min]",
];

const rows = selected.map((row, index) => [
  `SYN-${String(index + 1).padStart(4, "0")}`,
  row.type,
  row.airTemperature.toFixed(1),
  row.processTemperature.toFixed(1),
  row.rotationalSpeed,
  row.torque.toFixed(1),
  row.toolWear,
].join(","));

const scoredHeader = [...header, "Expected probability", "Expected risk level", "Expected review required"];
const scoredRows = selected.map((row, index) => [
  `SYN-${String(index + 1).padStart(4, "0")}`,
  row.type,
  row.airTemperature.toFixed(1),
  row.processTemperature.toFixed(1),
  row.rotationalSpeed,
  row.torque.toFixed(1),
  row.toolWear,
  row.probability.toFixed(6),
  row.riskLevel,
  row.probability >= model.decisionThreshold ? "Yes" : "No",
].join(","));

writeFileSync(path.join(root, "public", "sample-fleet.csv"), `${header.join(",")}\n${rows.join("\n")}\n`);
writeFileSync(path.join(root, "public", "sample-fleet-scored.csv"), `${scoredHeader.join(",")}\n${scoredRows.join("\n")}\n`);

const counts = selected.reduce((summary, row) => {
  summary[row.riskLevel] = (summary[row.riskLevel] || 0) + 1;
  return summary;
}, {});

console.log(JSON.stringify({
  generatedRows: selected.length,
  candidateRowsChecked: candidates.length,
  decisionThreshold: model.decisionThreshold,
  riskCounts: counts,
  uploadFile: "public/sample-fleet.csv",
  auditFile: "public/sample-fleet-scored.csv",
}, null, 2));
