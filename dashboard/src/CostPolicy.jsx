import { policyForRatio, testCost } from "./risk.js";

function Outcome({ label, value, tone = "" }) {
  return <div className={`fleet-summary ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function CostPolicy({ curve, policy, onChange }) {
  if (!curve) return null;
  const costBased = policy.mode === "cost";
  const active = costBased ? policyForRatio(curve, policy.ratio) : curve.frozen;
  const frozenCost = testCost(curve.frozen, policy.ratio);
  const activeCost = testCost(active, policy.ratio);
  const saving = frozenCost - activeCost;

  return (
    <section className="cost-policy" aria-label="Decision policy">
      <div className="cost-policy-heading">
        <div>
          <p className="eyebrow">Decision policy</p>
          <h2>How costly is a missed failure?</h2>
        </div>
        <div className="band-filter" role="group" aria-label="Threshold policy">
          <button type="button" className={!costBased ? "active" : ""} onClick={() => onChange({ ...policy, mode: "frozen" })}>Frozen threshold</button>
          <button type="button" className={costBased ? "active" : ""} onClick={() => onChange({ ...policy, mode: "cost" })}>Cost-based</button>
        </div>
      </div>

      <label className="cost-slider">
        <span>A missed failure costs <strong>{policy.ratio}×</strong> a false alarm</span>
        <input
          className="range-input" type="range" min="1" max="100" step="1" value={policy.ratio}
          aria-label="Cost of a missed failure relative to a false alarm"
          onChange={(event) => onChange({ mode: "cost", ratio: Number(event.target.value) })}
        />
        <span className="range-labels"><small>1× (equal cost)</small><small>100×</small></span>
      </label>

      <div className="cost-outcomes">
        <Outcome label="Review threshold" value={`${(active.threshold * 100).toFixed(1)}%`} />
        <Outcome label={`Missed of ${curve.testFailures} failures`} value={active.missed_failures} tone="critical" />
        <Outcome label={`False alarms of ${(curve.testRows - curve.testFailures).toLocaleString()}`} value={active.false_alarms} tone="warning" />
        <Outcome
          label={costBased ? "Cost vs frozen threshold" : "Cost at this ratio"}
          value={costBased ? (saving > 0 ? `−${saving}` : saving === 0 ? "same" : `+${-saving}`) : activeCost}
        />
      </div>
      <p className="scoring-note">
        {costBased
          ? "The threshold minimising cost was chosen on out-of-fold predictions from the 8,500 development machines, then checked on the 1,500 held-out test machines shown here. Costs are in units of one false alarm."
          : `The frozen threshold (${(curve.frozenThreshold * 100).toFixed(1)}%) was fixed before the test set was scored. Move the slider to apply a cost-based threshold to every score on this page.`}
      </p>
    </section>
  );
}
