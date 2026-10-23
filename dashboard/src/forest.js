// Browser-side scoring and explanation for the exported random forest.

export const FIELDS = [
  { name: "airTemperature", actionable: false, label: "Air temperature", unit: "K", min: 290, max: 310, step: 0.1 },
  { name: "processTemperature", actionable: false, label: "Process temperature", unit: "K", min: 300, max: 320, step: 0.1 },
  { name: "rotationalSpeed", actionable: true, label: "Rotational speed", unit: "rpm", min: 1000, max: 3000, step: 1 },
  { name: "torque", actionable: true, label: "Torque", unit: "Nm", min: 0, max: 80, step: 0.1 },
  { name: "toolWear", actionable: true, label: "Tool wear", unit: "min", min: 0, max: 260, step: 1 },
];

// The AI4I generating rules (Matzka, 2020), used to put explanations in context.
export const RULES = {
  heatDiffK: 8.6,
  heatSpeedRpm: 1380,
  powerBandW: [3500, 9000],
  strainLimit: { L: 11000, M: 12000, H: 13000 },
  toolWearWindow: [200, 240],
};

export function transformInputs(inputs, model) {
  const temperatureDifference = Number(inputs.processTemperature) - Number(inputs.airTemperature);
  const mechanicalPower = (2 * Math.PI * Number(inputs.rotationalSpeed) * Number(inputs.torque)) / 60;
  const strain = Number(inputs.torque) * Number(inputs.toolWear);
  const rawNumeric = [
    Number(inputs.airTemperature),
    Number(inputs.processTemperature),
    Number(inputs.rotationalSpeed),
    Number(inputs.torque),
    Number(inputs.toolWear),
    temperatureDifference,
    mechanicalPower,
    strain,
  ];
  const standardized = rawNumeric.map(
    (value, index) => Math.fround((value - model.means[index]) / model.scales[index]),
  );
  const encodedType = model.typeCategories.map((category) => (category === inputs.type ? 1 : 0));
  return { vector: [...standardized, ...encodedType], temperatureDifference, mechanicalPower, strain };
}

export function scoreForest(vector, model) {
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

export function calculateResult(inputs, model, threshold) {
  if (!inputs || !model) return null;
  const transformed = transformInputs(inputs, model);
  const probability = scoreForest(transformed.vector, model);
  return { ...transformed, probability, flagged: probability >= threshold };
}

// Path attribution (Saabas): each split moves the node's failure rate from
// parent to child, and that change is credited to the split feature. Summed
// over the forest, bias + contributions equals the predicted probability.
export function forestContributions(vector, model) {
  const contributions = new Array(vector.length).fill(0);
  let bias = 0;
  for (const tree of model.trees) {
    let node = 0;
    bias += tree.p[0];
    while (tree.l[node] !== -1) {
      const child = vector[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
      contributions[tree.f[node]] += tree.p[child] - tree.p[node];
      node = child;
    }
  }
  const n = model.trees.length;
  return { bias: bias / n, contributions: contributions.map((value) => value / n) };
}

function fmt(value, digits = 0) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function describe(key, inputs, derived) {
  const speed = Number(inputs.rotationalSpeed);
  const wear = Number(inputs.toolWear);
  const limit = RULES.strainLimit[inputs.type];
  const [low, high] = RULES.powerBandW;
  switch (key) {
    case "Temperature difference [K]":
      return {
        label: "Temperature gap",
        value: `${fmt(derived.temperatureDifference, 1)} K`,
        rule: "heat",
        context: derived.temperatureDifference < RULES.heatDiffK
          ? `Below ${RULES.heatDiffK} K, so heat is not carried away${speed < RULES.heatSpeedRpm ? " — and speed is low too" : ""}`
          : `Above the ${RULES.heatDiffK} K heat-dissipation limit`,
        breached: derived.temperatureDifference < RULES.heatDiffK && speed < RULES.heatSpeedRpm,
      };
    case "Rotational speed [rpm]":
      return {
        label: "Rotational speed",
        value: `${fmt(speed)} rpm`,
        rule: "heat",
        context: speed >= RULES.heatSpeedRpm
          ? `Above the ${fmt(RULES.heatSpeedRpm)} rpm overheating zone`
          : derived.temperatureDifference < RULES.heatDiffK
            ? `Below ${fmt(RULES.heatSpeedRpm)} rpm with a small temperature gap: overheating zone`
            : `Below ${fmt(RULES.heatSpeedRpm)} rpm; overheating also needs a gap under ${RULES.heatDiffK} K`,
        breached: speed < RULES.heatSpeedRpm && derived.temperatureDifference < RULES.heatDiffK,
      };
    case "Mechanical power [W]": {
      const outside = derived.mechanicalPower < low || derived.mechanicalPower > high;
      return {
        label: "Mechanical power",
        value: `${fmt(derived.mechanicalPower)} W`,
        rule: "power",
        context: outside
          ? `${derived.mechanicalPower > high ? "Above" : "Below"} the ${fmt(low)}–${fmt(high)} W safe band`
          : `Inside the ${fmt(low)}–${fmt(high)} W safe band`,
        breached: outside,
      };
    }
    case "Torque × tool wear":
      return {
        label: "Strain (torque × wear)",
        value: `${fmt(derived.strain)} Nm·min`,
        rule: "strain",
        context: derived.strain > limit
          ? `Above the ${fmt(limit)} overstrain limit for type ${inputs.type}`
          : `${Math.round((derived.strain / limit) * 100)}% of the ${fmt(limit)} overstrain limit for type ${inputs.type}`,
        breached: derived.strain > limit,
      };
    case "Tool wear [min]":
      return {
        label: "Tool wear",
        value: `${fmt(wear)} min`,
        rule: "wear",
        context: wear >= RULES.toolWearWindow[0]
          ? `In the ${RULES.toolWearWindow[0]}–${RULES.toolWearWindow[1]} min window where tools fail at random`
          : `${RULES.toolWearWindow[0] - wear} min before the tool-failure window`,
        breached: wear >= RULES.toolWearWindow[0],
      };
    case "Torque [Nm]":
      return { label: "Torque", value: `${fmt(inputs.torque, 1)} Nm`, rule: null, context: "Feeds both power and strain", breached: false };
    case "Air temperature [K]":
      return { label: "Air temperature", value: `${fmt(inputs.airTemperature, 1)} K`, rule: null, context: "Sets the temperature gap", breached: false };
    case "Process temperature [K]":
      return { label: "Process temperature", value: `${fmt(inputs.processTemperature, 1)} K`, rule: null, context: "Sets the temperature gap", breached: false };
    default:
      return { label: "Product type", value: inputs.type, rule: "strain", context: "Sets the overstrain limit", breached: false };
  }
}

// Plain-language reasons, largest effect first. `points` are percentage
// points of failure probability relative to the forest's average machine.
export function explainInputs(inputs, model) {
  const derived = transformInputs(inputs, model);
  const { bias, contributions } = forestContributions(derived.vector, model);
  const grouped = new Map();
  contributions.forEach((value, index) => {
    const key = index < model.numericFeatures.length ? model.numericFeatures[index] : "Type";
    grouped.set(key, (grouped.get(key) || 0) + value);
  });
  const reasons = [...grouped.entries()].map(([key, value]) => ({
    key, points: value * 100, ...describe(key, inputs, derived),
  }));
  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { baseline: bias * 100, reasons };
}

function roundToStep(value, field) {
  const decimals = String(field.step).split(".")[1]?.length || 0;
  return Number((Math.round(value / field.step) * field.step).toFixed(decimals));
}

// For each reading, the nearest value (others held fixed) that moves the
// machine to the other side of the threshold: below it if flagged, above it
// if not. Returns the smallest moves first, measured as a share of the range.
export function thresholdCrossings(inputs, model, threshold, { gridPoints = 120 } = {}) {
  const flagged = calculateResult(inputs, model, threshold).flagged;
  const crosses = (candidate) => calculateResult(candidate, model, threshold).flagged !== flagged;
  const moves = [];
  for (const field of FIELDS) {
    const current = Number(inputs[field.name]);
    const span = field.max - field.min;
    let best = null;
    for (let i = 0; i <= gridPoints; i += 1) {
      const value = field.min + (span * i) / gridPoints;
      if (best !== null && Math.abs(value - current) >= Math.abs(best - current)) continue;
      if (crosses({ ...inputs, [field.name]: value })) best = value;
    }
    if (best === null) continue;
    // Refine between the current value and the coarse hit.
    let near = Math.min(Math.max(current, field.min), field.max); // typed values can sit outside the range
    let far = best;
    for (let step = 0; step < 18; step += 1) {
      const mid = (near + far) / 2;
      if (crosses({ ...inputs, [field.name]: mid })) far = mid;
      else near = mid;
    }
    const clamp = (value) => Math.min(Math.max(value, field.min), field.max);
    let to = clamp(roundToStep(far, field));
    if (!crosses({ ...inputs, [field.name]: to })) to = clamp(roundToStep(far + Math.sign(far - current) * field.step, field));
    if (to === current || !crosses({ ...inputs, [field.name]: to })) continue;
    const probability = calculateResult({ ...inputs, [field.name]: to }, model, threshold).probability;
    moves.push({ ...field, from: current, to, probability, share: Math.abs(to - current) / span });
  }
  // Operator-controllable readings first: temperatures are mostly set by the environment.
  moves.sort((a, b) => Number(b.actionable) - Number(a.actionable) || a.share - b.share);
  return { flagged, moves };
}

// Status of each documented failure rule for one machine: "triggered",
// "near" (within 10% of the limit) or "clear". Random failures (RNF) have no rule.
export function ruleStatus(inputs) {
  const gap = Number(inputs.processTemperature) - Number(inputs.airTemperature);
  const speed = Number(inputs.rotationalSpeed);
  const power = (2 * Math.PI * speed * Number(inputs.torque)) / 60;
  const strain = Number(inputs.torque) * Number(inputs.toolWear);
  const wear = Number(inputs.toolWear);
  const limit = RULES.strainLimit[inputs.type];
  const [low, high] = RULES.powerBandW;
  const status = (triggered, near) => (triggered ? "triggered" : near ? "near" : "clear");
  return [
    {
      key: "heat", label: "Heat dissipation",
      detail: `Gap ${fmt(gap, 1)} K (limit ${RULES.heatDiffK}) and speed ${fmt(speed)} rpm (limit ${fmt(RULES.heatSpeedRpm)})`,
      status: status(gap < RULES.heatDiffK && speed < RULES.heatSpeedRpm, gap < RULES.heatDiffK * 1.1 && speed < RULES.heatSpeedRpm * 1.1),
    },
    {
      key: "power", label: "Power",
      detail: `${fmt(power)} W (safe ${fmt(low)}–${fmt(high)})`,
      status: status(power < low || power > high, power < low * 1.1 || power > high * 0.9),
    },
    {
      key: "strain", label: "Overstrain",
      detail: `${fmt(strain)} Nm·min (limit ${fmt(limit)} for type ${inputs.type})`,
      status: status(strain > limit, strain > limit * 0.9),
    },
    {
      key: "wear", label: "Tool wear",
      detail: `${fmt(wear)} min (random failures from ${RULES.toolWearWindow[0]} min)`,
      status: status(wear >= RULES.toolWearWindow[0], wear >= RULES.toolWearWindow[0] * 0.9),
    },
  ];
}

export const SCENARIOS = [
  {
    key: "healthy", label: "Healthy",
    note: "Normal speed, torque and a fresh tool.",
    inputs: { type: "L", airTemperature: 298.1, processTemperature: 308.6, rotationalSpeed: 1551, torque: 42.8, toolWear: 0 },
  },
  {
    key: "heat", label: "Overheating",
    note: "Small temperature gap at low speed, so heat can't escape.",
    inputs: { type: "L", airTemperature: 302.0, processTemperature: 310.0, rotationalSpeed: 1300, torque: 55, toolWear: 50 },
  },
  {
    key: "power", label: "Power failure",
    note: "High torque pushes power above 9,000 W.",
    inputs: { type: "M", airTemperature: 299.0, processTemperature: 309.5, rotationalSpeed: 1350, torque: 70, toolWear: 30 },
  },
  {
    key: "strain", label: "Overstrain",
    note: "Torque × tool wear above the type-L limit of 11,000.",
    inputs: { type: "L", airTemperature: 299.0, processTemperature: 309.5, rotationalSpeed: 1400, torque: 58, toolWear: 200 },
  },
  {
    key: "wear", label: "Worn tool",
    note: "220 min of wear. These failures happen at random, so the model rarely catches them.",
    inputs: { type: "M", airTemperature: 299.0, processTemperature: 309.5, rotationalSpeed: 1500, torque: 35, toolWear: 220 },
  },
];

// For each reading, the range that keeps every documented failure rule clear
// while the other readings stay as they are. Missing bound = open-ended,
// null = any value is fine, { none: true } = no value can clear the rules.
export function idealRanges(inputs) {
  const speed = Number(inputs.rotationalSpeed);
  const torque = Number(inputs.torque);
  const wear = Number(inputs.toolWear);
  const gap = Number(inputs.processTemperature) - Number(inputs.airTemperature);
  const k = 60 / (2 * Math.PI); // power (W) = speed (rpm) * torque (Nm) / k
  const [low, high] = RULES.powerBandW;
  const limit = RULES.strainLimit[inputs.type];
  const raw = {
    airTemperature: speed >= RULES.heatSpeedRpm ? null : { max: Number(inputs.processTemperature) - RULES.heatDiffK },
    processTemperature: speed >= RULES.heatSpeedRpm ? null : { min: Number(inputs.airTemperature) + RULES.heatDiffK },
    rotationalSpeed: { min: Math.max((low * k) / torque, gap < RULES.heatDiffK ? RULES.heatSpeedRpm : 0), max: (high * k) / torque },
    torque: { min: (low * k) / speed, max: Math.min((high * k) / speed, wear ? limit / wear : Infinity) },
    toolWear: { max: Math.min(RULES.toolWearWindow[0] - 1, torque ? limit / torque : Infinity) },
  };
  return Object.fromEntries(FIELDS.map((field) => {
    const range = raw[field.name];
    if (!range) return [field.name, null];
    const min = range.min > field.min ? range.min : undefined;
    const max = range.max < field.max ? range.max : undefined;
    if ((min ?? field.min) > (max ?? field.max)) return [field.name, { none: true }];
    return [field.name, { min, max }];
  }));
}

export function isIdeal(value, range) {
  if (!range) return true;
  if (range.none) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}
