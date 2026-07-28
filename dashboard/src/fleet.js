export const REQUIRED_COLUMNS = [
  "Machine ID",
  "Type",
  "Air temperature [K]",
  "Process temperature [K]",
  "Rotational speed [rpm]",
  "Torque [Nm]",
  "Tool wear [min]",
];

export const LEAKAGE_COLUMNS = ["Machine failure", "TWF", "HDF", "PWF", "OSF", "RNF"];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  if (!rows.length) throw new Error("The CSV file is empty.");
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column names.");
  return { headers, records: rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) };
}

const numericRules = [
  ["Air temperature [K]", "airTemperature", 290, 310],
  ["Process temperature [K]", "processTemperature", 300, 320],
  ["Rotational speed [rpm]", "rotationalSpeed", 1000, 3000],
  ["Torque [Nm]", "torque", 0, 80],
  ["Tool wear [min]", "toolWear", 0, 260],
];

export function validateFleetCsv(text, scoreInputs) {
  const { headers, records } = parseCsv(text);
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const leakage = LEAKAGE_COLUMNS.filter((column) => headers.includes(column));
  if (leakage.length) throw new Error(`Remove target or leakage columns before scoring: ${leakage.join(", ")}`);
  if (records.length > 5000) throw new Error("The dashboard accepts at most 5,000 rows per upload.");

  const seenIds = new Set();
  const valid = [];
  const invalid = [];
  records.forEach((record, index) => {
    const errors = [];
    const machineId = record["Machine ID"].trim();
    const type = record.Type.trim().toUpperCase();
    if (!machineId) errors.push("Machine ID is required");
    if (seenIds.has(machineId)) errors.push("Duplicate Machine ID");
    if (machineId) seenIds.add(machineId);
    if (!["L", "M", "H"].includes(type)) errors.push("Type must be L, M, or H");
    const inputs = { type };
    for (const [column, name, min, max] of numericRules) {
      const value = Number(record[column]);
      if (record[column] === "" || !Number.isFinite(value)) errors.push(`${column} must be numeric`);
      else if (value < min || value > max) errors.push(`${column} must be between ${min} and ${max}`);
      inputs[name] = value;
    }
    if (errors.length) invalid.push({ rowNumber: index + 2, machineId: machineId || "(missing)", errors });
    else valid.push({ machineId, inputs, ...scoreInputs(inputs) });
  });
  return { valid, invalid, totalRows: records.length };
}

export function resultsToCsv(rows) {
  const header = [...REQUIRED_COLUMNS, "Failure probability", "Risk level", "Review required", "Recommended action"];
  const body = rows.map((row) => [
    row.machineId, row.inputs.type, row.inputs.airTemperature, row.inputs.processTemperature,
    row.inputs.rotationalSpeed, row.inputs.torque, row.inputs.toolWear,
    row.probability.toFixed(6), row.risk.label, row.flagged ? "Yes" : "No",
    row.flagged ? "Engineering inspection" : "Routine monitoring",
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  return [header.join(","), ...body].join("\n");
}

export function invalidToCsv(rows) {
  return ["Row,Machine ID,Validation errors", ...rows.map((row) =>
    `${row.rowNumber},"${row.machineId.replaceAll('"', '""')}","${row.errors.join("; ").replaceAll('"', '""')}"`,
  )].join("\n");
}
