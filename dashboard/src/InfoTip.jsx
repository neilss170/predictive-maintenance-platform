import { useId, useState } from "react";

// One-sentence definitions for the terms the dashboard uses.
export const GLOSSARY = {
  prAuc: "PR-AUC summarises how well the model ranks failing machines above healthy ones across every threshold. 1.0 is perfect; guessing scores about 0.03 here, the share of machines that fail.",
  rmse: "Root-mean-square error: the typical size of the remaining-life error, in cycles. Large misses count extra.",
  alarmRecall: "Of the engines that really had 30 or fewer cycles left, the share the model warned about.",
  alarmPrecision: "Of the engines the model warned about, the share that really had 30 or fewer cycles left.",
  threshold: "The failure probability at which a machine is sent for review. Lower catches more failures but raises more false alarms.",
  probability: "The model's estimated chance this machine fails, from 500 decision trees voting on its readings.",
  points: "How many percentage points each reading adds to (red) or removes from (green) this machine's probability, starting from the forest's neutral 50% (failures were up-weighted in training). Start plus all the points equals the score exactly.",
  precision: "When the model flags a machine, how often it really fails.",
  recall: "Of the machines that really fail, how many the model flags.",
  interval: "95% bootstrap interval: re-scoring thousands of resampled test sets, the result landed in this range 95% of the time.",
  rulRange: "80% range: on held-out training engines with a similar forecast, the true remaining life fell inside this range 8 times out of 10.",
  brier: "Brier score: the average squared gap between predicted probability and what happened. Lower is better; 0 is perfect.",
  cost: "Cost per 1,000 machines uses the 1,500 held-out test machines: missed failures × their cost plus false alarms × theirs, scaled to 1,000.",
  ruleStatus: "Triggered: the reading breaks one of the dataset's documented failure rules. Close: within 10% of the limit. Clear: safely inside it.",
  ideal: "Ideal ranges keep every documented failure rule clear while the other readings stay where they are, so they move as you change those readings. About 0.1% of machines still fail at random.",
  rulCap: "Training targets are capped at 125 cycles, so a healthy engine reads \"125\", meaning at least 125.",
};

export function InfoTip({ term, text, label = "What does this mean?" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="info-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" className="info-tip-button" aria-label={label} aria-describedby={open ? id : undefined}
        aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      >i</button>
      {open && <span role="tooltip" id={id} className="info-tip-bubble">{text ?? GLOSSARY[term]}</span>}
    </span>
  );
}
