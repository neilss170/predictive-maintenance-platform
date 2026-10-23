import { useState } from "react";
import { InfoTip } from "./InfoTip.jsx";

function signed(points) {
  const rounded = Math.abs(points) < 0.05 ? 0 : points;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
}

export function WhyScore({ explanation, probability, limit = 4 }) {
  const [showAll, setShowAll] = useState(false);
  const { baseline, reasons } = explanation;
  const shown = showAll ? reasons : reasons.slice(0, limit);
  const scale = Math.max(...reasons.map((reason) => Math.abs(reason.points)), 1);
  return (
    <div className="explain">
      <div className="explain-head">
        <strong>Why this score</strong>
        <InfoTip term="points" label="How the reasons are calculated" />
      </div>
      <p className="explain-base">
        The trees start at a neutral <strong>{baseline.toFixed(0)}%</strong> (failures were up-weighted in training). These readings move it to <strong>{(probability * 100).toFixed(1)}%</strong>.
      </p>
      <ul className="reason-list">
        {shown.map((reason) => (
          <li key={reason.key} className={reason.points >= 0 ? "raises" : "lowers"}>
            <div className="reason-text">
              <span>{reason.label} <b>{reason.value}</b></span>
              <small className={reason.breached ? "breached" : ""}>{reason.context}</small>
            </div>
            <div className="reason-bar" aria-hidden="true">
              <i style={{ width: `${(Math.abs(reason.points) / scale) * 50}%` }} />
            </div>
            <strong className="reason-points">{signed(reason.points)} pts</strong>
          </li>
        ))}
      </ul>
      {reasons.length > limit && (
        <button type="button" className="text-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show top reasons" : `Show all ${reasons.length} readings`}
        </button>
      )}
    </div>
  );
}

function formatValue(value, field) {
  const decimals = String(field.step).split(".")[1]?.length || 0;
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function WhatIf({ crossings, onTry, limit = 3 }) {
  if (!crossings) return null;
  const { flagged, moves } = crossings;
  return (
    <div className="what-if">
      <strong>{flagged ? "What would clear it" : "How close it is to review"}</strong>
      <p>{flagged
        ? "The smallest single change to each reading that brings this machine below the review threshold."
        : "The smallest single change to each reading that would send this machine for review."}</p>
      {moves.length === 0 ? (
        <p className="empty-copy">{flagged
          ? "No single reading change clears it: several readings are driving the risk together."
          : "No single reading change within the dashboard ranges would flag it."}</p>
      ) : (
        <ul className="move-list">
          {moves.slice(0, limit).map((move) => (
            <li key={move.name}>
              <span>
                {move.name === "toolWear" && move.to === 0 ? "Replace the tool" : `${move.to > move.from ? "Raise" : "Lower"} ${move.label.toLowerCase()}`}
                <b>{formatValue(move.from, move)} → {formatValue(move.to, move)} {move.unit}</b>
              </span>
              <small>{(move.probability * 100).toFixed(1)}%{!move.actionable && " · environment"}</small>
              {onTry && <button type="button" onClick={() => onTry(move)}>Try it</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_LABEL = { triggered: "Triggered", near: "Close", clear: "Clear" };

export function RuleCheck({ rules }) {
  return (
    <ul className="rule-list">
      {rules.map((rule) => (
        <li key={rule.key}>
          <div><strong>{rule.label}</strong><small>{rule.detail}</small></div>
          <span className={`rule-status ${rule.status}`}>{STATUS_LABEL[rule.status]}</span>
        </li>
      ))}
    </ul>
  );
}
