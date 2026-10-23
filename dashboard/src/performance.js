// Held-out test machines and decision counts for the performance view.

export function machinesFrom(data) {
  return data.rows.map((row, index) => {
    const record = Object.fromEntries(data.columns.map((column, i) => [column, row[i]]));
    const { failed, modes, ...inputs } = record;
    return { id: index + 1, inputs, failed: failed === 1, modes: modes ? modes.split(",") : [] };
  });
}

export function confusion(machines, threshold) {
  const counts = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const machine of machines) {
    const flagged = machine.probability >= threshold;
    if (machine.failed) counts[flagged ? "tp" : "fn"] += 1;
    else counts[flagged ? "fp" : "tn"] += 1;
  }
  return counts;
}
