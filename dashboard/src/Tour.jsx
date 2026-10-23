import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const TOUR_STEPS = [
  {
    target: "tabs",
    title: "Four views, two models",
    body: "Single machine and Fleet score failure risk. Model performance shows how well that model did on machines it never saw. Engine RUL forecasts how many cycles a jet engine has left.",
  },
  {
    target: "policy",
    title: "Say what a mistake costs",
    body: "Enter what a missed failure and a false alarm cost in rupees. The review threshold moves to the cheapest setting, and every score on the page follows it.",
  },
  {
    target: "scenarios",
    title: "Try a failure",
    body: "Pick a scenario, such as Overheating or Power failure, or move any slider. The 500-tree model rescores instantly in your browser.",
  },
  {
    target: "result",
    title: "Read the score and the reasons",
    body: "See the failure probability, which readings push it up or down, and the smallest change that would clear the machine. Tap Try it to apply one.",
  },
];

export function Tour({ open, onClose, onBeforeStep }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const current = TOUR_STEPS[step];

  const measure = useCallback(() => {
    const element = document.querySelector(`[data-tour="${current.target}"]`);
    setRect(element ? element.getBoundingClientRect() : null);
  }, [current.target]);

  useEffect(() => { if (open) setStep(0); }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    onBeforeStep?.(current.target);
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-tour="${current.target}"]`)?.scrollIntoView({ block: "center", behavior: "instant" });
      measure();
      cardRef.current?.focus();
    });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, current.target, measure, onBeforeStep]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setStep((value) => Math.min(value + 1, TOUR_STEPS.length - 1));
      if (event.key === "ArrowLeft") setStep((value) => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const last = step === TOUR_STEPS.length - 1;
  const pad = 8;
  const spotlight = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const roomBelow = rect ? window.innerHeight - rect.bottom : 0;
  const cardStyle = !rect || window.innerWidth < 680
    ? {}
    : roomBelow > 230
      ? { top: rect.bottom + 16, left: Math.min(Math.max(rect.left, 16), window.innerWidth - 376) }
      : { top: Math.max(rect.top - 216, 16), left: Math.min(Math.max(rect.left, 16), window.innerWidth - 376) };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {spotlight ? <div className="tour-spotlight" style={spotlight} /> : <div className="tour-backdrop" />}
      <div className={`tour-card ${window.innerWidth < 680 ? "docked" : ""}`} style={cardStyle} ref={cardRef} tabIndex={-1}>
        <p className="eyebrow">Step {step + 1} of {TOUR_STEPS.length}</p>
        <h2 id="tour-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={onClose}>Skip tour</button>
          <div>
            {step > 0 && <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>Back</button>}
            <button type="button" className="primary-button" onClick={() => (last ? onClose() : setStep(step + 1))}>{last ? "Start exploring" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
