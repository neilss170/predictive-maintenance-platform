import { InfoTip } from "./InfoTip.jsx";
import { costPer1000, costRatio, policyForRatio } from "./risk.js";

export const DEFAULT_POLICY = { mode: "frozen", missCost: 50000, alarmCost: 2000 };

const PRESETS = [
  { label: "Routine line", missCost: 10000, alarmCost: 2000 },
  { label: "Typical plant", missCost: 50000, alarmCost: 2000 },
  { label: "Critical asset", missCost: 200000, alarmCost: 2000 },
];

const rupees = (value) => `₹${Math.round(value).toLocaleString("en-IN")}`;

function Outcome({ label, value, tone = "", term }) {
  return (
    <div className={`fleet-summary ${tone}`}>
      <span>{label}{term && <InfoTip term={term} />}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function activeThreshold(curve, policy, frozenThreshold) {
  if (policy.mode !== "cost" || !curve) return frozenThreshold;
  return policyForRatio(curve, costRatio(policy.missCost, policy.alarmCost)).threshold;
}

export function CostPolicy({ curve, policy, onChange }) {
  if (!curve) return null;
  const costBased = policy.mode === "cost";
  const ratio = costRatio(policy.missCost, policy.alarmCost);
  const exactRatio = Number(policy.alarmCost) > 0 ? Number(policy.missCost) / Number(policy.alarmCost) : Infinity;
  const active = costBased ? policyForRatio(curve, ratio) : curve.frozen;
  const cost = costPer1000(active, policy.missCost, policy.alarmCost, curve.testRows);
  const frozenCost = costPer1000(curve.frozen, policy.missCost, policy.alarmCost, curve.testRows);
  const saving = frozenCost - cost;
  const setCost = (field, value) => onChange({ ...policy, mode: "cost", [field]: Math.max(0, Number(value) || 0) });

  return (
    <section className="cost-policy" aria-label="Decision policy" data-tour="policy">
      <div className="cost-policy-heading">
        <div>
          <p className="eyebrow">Decision policy</p>
          <h2>What does a mistake cost?</h2>
        </div>
        <div className="band-filter" role="group" aria-label="Threshold policy">
          <button type="button" className={!costBased ? "active" : ""} onClick={() => onChange({ ...policy, mode: "frozen" })}>Frozen threshold</button>
          <button type="button" className={costBased ? "active" : ""} onClick={() => onChange({ ...policy, mode: "cost" })}>Cost-based</button>
        </div>
      </div>

      <div className="cost-inputs">
        <label>
          <span>Cost of a missed failure</span>
          <div className="input-wrap"><small>₹</small>
            <input type="number" min="0" step="1000" value={policy.missCost} aria-label="Cost of a missed failure in rupees"
              onChange={(event) => setCost("missCost", event.target.value)} />
          </div>
        </label>
        <label>
          <span>Cost of a false alarm</span>
          <div className="input-wrap"><small>₹</small>
            <input type="number" min="0" step="500" value={policy.alarmCost} aria-label="Cost of a false alarm in rupees"
              onChange={(event) => setCost("alarmCost", event.target.value)} />
          </div>
        </label>
        <div className="cost-presets" role="group" aria-label="Cost presets">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button"
              className={costBased && preset.missCost === policy.missCost && preset.alarmCost === policy.alarmCost ? "active" : ""}
              onClick={() => onChange({ mode: "cost", missCost: preset.missCost, alarmCost: preset.alarmCost })}>
              {preset.label}<small>{rupees(preset.missCost)} / {rupees(preset.alarmCost)}</small>
            </button>
          ))}
        </div>
      </div>
      <p className="cost-ratio">
        A missed failure costs <strong>{Number.isFinite(exactRatio) ? `${Math.round(exactRatio * 10) / 10}×` : "far more than"}</strong> a false alarm
        {exactRatio > 100 ? " (policies are tuned up to 100×, so 100× is used)." : exactRatio < 1 ? " (treated as 1×: a miss is never cheaper than an alarm)." : "."}
      </p>

      <div className="cost-outcomes">
        <Outcome label="Review threshold" value={`${(active.threshold * 100).toFixed(1)}%`} term="threshold" />
        <Outcome label={`Missed of ${curve.testFailures} failures`} value={active.missed_failures} tone="critical" />
        <Outcome label={`False alarms of ${(curve.testRows - curve.testFailures).toLocaleString("en-IN")}`} value={active.false_alarms} tone="warning" />
        <Outcome
          label="Cost per 1,000 machines" term="cost"
          value={<>{rupees(cost)}{costBased && <small className={saving > 0 ? "improved" : saving < 0 ? "worsened" : ""}>
            {saving > 0 ? `saves ${rupees(saving)}` : saving < 0 ? `${rupees(-saving)} more` : "same as frozen"}
          </small>}</>}
        />
      </div>
      <p className="scoring-note">
        {costBased
          ? "The cheapest threshold for this cost ratio was chosen on out-of-fold predictions from the 8,500 development machines, then checked on the 1,500 held-out test machines shown here. Every score on this page now uses it."
          : `The frozen threshold (${(curve.frozenThreshold * 100).toFixed(1)}%) was fixed before the test set was scored. Enter your own costs to find the threshold that minimises them.`}
      </p>
    </section>
  );
}
