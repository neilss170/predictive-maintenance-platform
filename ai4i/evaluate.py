"""Deeper evaluation of the frozen AI4I failure-risk pipeline.

Adds what the original notebook did not report: a rule-based baseline built
from the dataset's documented failure rules, SHAP evidence that the forest
recovered those rules, bootstrap ranges for test metrics, calibration, and a
cost-based decision threshold. The pipeline itself is not retrained.

The deployed pipeline was fit on train + validation (8,500 rows), so cost
thresholds are chosen on out-of-fold predictions over those rows and only then
scored on the sealed 1,500-row test split.

    python -m ai4i.evaluate
"""

from __future__ import annotations

import json

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from sklearn.base import clone
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from ai4i.rules import (
    HDF_SPEED_RPM,
    HDF_TEMP_DIFF_K,
    OSF_STRAIN_MIN_NM,
    PWF_POWER_W,
    rule_baseline,
)
from predict import METADATA_PATH, MODEL_PATH, PROJECT_ROOT


DATA_DIR = PROJECT_ROOT / "data" / "governed"
REPORT_PATH = PROJECT_ROOT / "reports" / "ai4i_evaluation.json"
FIGURE_DIR = PROJECT_ROOT / "reports" / "figures"
WEB_PATH = PROJECT_ROOT / "dashboard" / "public" / "cost-curve.json"
POLICY_PATH = PROJECT_ROOT / "models" / "ai4i_cost_policy.json"
WEB_TEST_PATH = PROJECT_ROOT / "dashboard" / "public" / "test-machines.json"

TARGET = "Machine failure"
MODES = ["TWF", "HDF", "PWF", "OSF", "RNF"]
SEED = 42
BOOTSTRAP_SAMPLES = 2000
COST_RATIOS = list(range(1, 101))  # cost of a missed failure, in false alarms
REPORTED_RATIOS = [1, 5, 10, 20, 50, 100]


def engineer(raw: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Same derived columns as predict.build_feature_row, for a whole frame."""
    df = raw.copy()
    df["Temperature difference [K]"] = df["Process temperature [K]"] - df["Air temperature [K]"]
    df["Mechanical power [W]"] = 2 * np.pi * df["Rotational speed [rpm]"] * df["Torque [Nm]"] / 60
    df[features[-1]] = df["Torque [Nm]"] * df["Tool wear [min]"]
    return df[features]


def classification(y, flagged) -> dict:
    return {
        "precision": float(precision_score(y, flagged, zero_division=0)),
        "recall": float(recall_score(y, flagged, zero_division=0)),
        "f1": float(f1_score(y, flagged, zero_division=0)),
        "flagged": int(np.sum(flagged)),
        "missed_failures": int(np.sum((y == 1) & ~flagged)),
        "false_alarms": int(np.sum((y == 0) & flagged)),
    }


def bootstrap(y, prob, threshold) -> dict:
    """95% ranges from resampling the 1,500 test machines with replacement."""
    rng = np.random.default_rng(SEED)
    y, prob = np.asarray(y), np.asarray(prob)
    metrics = {
        "pr_auc": lambda t, p: average_precision_score(t, p),
        "roc_auc": lambda t, p: roc_auc_score(t, p),
        "precision": lambda t, p: precision_score(t, p >= threshold, zero_division=0),
        "recall": lambda t, p: recall_score(t, p >= threshold),
        "f1": lambda t, p: f1_score(t, p >= threshold),
        "brier": lambda t, p: brier_score_loss(t, p),
    }
    samples = {name: [] for name in metrics}
    for _ in range(BOOTSTRAP_SAMPLES):
        idx = rng.integers(0, len(y), len(y))
        if y[idx].min() == y[idx].max():
            continue
        for name, metric in metrics.items():
            samples[name].append(metric(y[idx], prob[idx]))
    return {name: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))] for name, v in samples.items()}


def cost_threshold(y, prob, ratio: float) -> float:
    """Threshold minimising ratio x missed failures + false alarms."""
    order = np.argsort(-prob)
    y_sorted, p_sorted = np.asarray(y)[order], prob[order]
    # Flagging the top k machines: k ranges over every distinct-probability cut.
    false_alarms = np.concatenate([[0], np.cumsum(1 - y_sorted)])
    missed = y_sorted.sum() - np.concatenate([[0], np.cumsum(y_sorted)])
    cuts = np.concatenate([[0], np.flatnonzero(np.diff(p_sorted)) + 1, [len(p_sorted)]])
    cost = ratio * missed[cuts] + false_alarms[cuts]
    best = cuts[int(np.argmin(cost))]
    if best == 0:
        return 1.0 + 1e-9
    if best == len(p_sorted):
        return 0.0
    # Midpoint between the last flagged and first unflagged probability.
    return float((p_sorted[best - 1] + p_sorted[best]) / 2)


def cost_table(y_dev, oof, y_test, prob_test) -> list[dict]:
    rows = []
    for ratio in COST_RATIOS:
        threshold = cost_threshold(y_dev, oof, ratio)
        flagged = prob_test >= threshold
        result = classification(y_test, flagged)
        rows.append({
            "ratio": ratio,
            "threshold": round(threshold, 4),
            **{k: result[k] for k in ["flagged", "missed_failures", "false_alarms"]},
            "precision": round(result["precision"], 4),
            "recall": round(result["recall"], 4),
            "test_cost": ratio * result["missed_failures"] + result["false_alarms"],
        })
    return rows


def shap_rule_figure(model, X_test: pd.DataFrame, raw_test: pd.DataFrame) -> dict:
    """SHAP dependence for the rule variables, with the documented rule boundaries."""
    pre, forest = model.named_steps["pre"], model.named_steps["model"]
    transformed = pre.transform(X_test)
    names = list(pre.get_feature_names_out())
    explainer = shap.TreeExplainer(forest)
    values = explainer.shap_values(transformed)
    values = values[:, :, 1] if values.ndim == 3 else values[1]
    contribution = pd.DataFrame(values, columns=[n.split("__", 1)[1] for n in names])

    panels = [
        ("Temperature difference [K]", [HDF_TEMP_DIFF_K], "Heat dissipation rule: < 8.6 K"),
        ("Rotational speed [rpm]", [HDF_SPEED_RPM], "Heat dissipation rule: < 1,380 rpm"),
        ("Mechanical power [W]", list(PWF_POWER_W), "Power rule: outside 3,500–9,000 W"),
        (X_test.columns[-1], sorted(OSF_STRAIN_MIN_NM.values()), "Overstrain rule: 11k / 12k / 13k (L / M / H)"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(11, 7.5))
    for ax, (feature, bounds, title) in zip(axes.ravel(), panels):
        ax.scatter(X_test[feature], contribution[feature], s=6, alpha=0.45, color="#2563eb", linewidths=0)
        for bound in bounds:
            ax.axvline(bound, color="#dc2626", ls="--", lw=1.2)
        ax.axhline(0, color="#64748b", lw=0.6)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel(feature)
        ax.set_ylabel("SHAP contribution to failure probability")
    fig.suptitle("The forest's risk jumps at the dataset's documented failure boundaries (test set)", fontsize=12)
    fig.tight_layout()
    fig.savefig(FIGURE_DIR / "ai4i_shap_rules.png", dpi=130)
    plt.close(fig)

    # Quantify each step: mean SHAP on the rule's failing side vs the safe side.
    temp_diff = X_test["Temperature difference [K]"]
    speed = X_test["Rotational speed [rpm]"]
    power = X_test["Mechanical power [W]"]
    strain = X_test[X_test.columns[-1]]
    strain_limit = raw_test["Type"].map(OSF_STRAIN_MIN_NM)
    sides = {
        "Temperature difference [K]": temp_diff < HDF_TEMP_DIFF_K,
        "Rotational speed [rpm]": speed < HDF_SPEED_RPM,
        "Mechanical power [W]": (power < PWF_POWER_W[0]) | (power > PWF_POWER_W[1]),
        X_test.columns[-1]: strain > strain_limit,
    }
    importance = contribution.abs().mean().sort_values(ascending=False)
    return {
        "mean_abs_shap": {k: round(float(v), 5) for k, v in importance.items()},
        "rule_side_mean_shap": {
            feature: {
                "failing_side": round(float(contribution.loc[side.to_numpy(), feature].mean()), 5),
                "safe_side": round(float(contribution.loc[~side.to_numpy(), feature].mean()), 5),
                "machines_on_failing_side": int(side.sum()),
            }
            for feature, side in sides.items()
        },
    }


def expected_calibration_error(y, prob, bins: int = 10) -> float:
    """Machine-weighted gap between predicted and observed failure rate, uniform bins."""
    edges = np.linspace(0, 1, bins + 1)
    index = np.clip(np.digitize(prob, edges[1:-1]), 0, bins - 1)
    return float(sum(
        np.mean(index == b) * abs(prob[index == b].mean() - np.asarray(y)[index == b].mean())
        for b in range(bins) if np.any(index == b)
    ))


def calibration_figure(y_test, prob_test, y_dev, oof) -> None:
    fig, ax = plt.subplots(figsize=(5.5, 5))
    edges = np.linspace(0, 1, 11)
    for label, y, p, color in [("Out-of-fold dev (8,500)", y_dev, oof, "#94a3b8"), ("Test (1,500)", y_test, prob_test, "#2563eb")]:
        index = np.clip(np.digitize(p, edges[1:-1]), 0, 9)
        used = [b for b in range(10) if np.any(index == b)]
        mean_pred = [p[index == b].mean() for b in used]
        true_rate = [np.asarray(y)[index == b].mean() for b in used]
        counts = np.array([np.sum(index == b) for b in used])
        ax.plot(mean_pred, true_rate, color=color, lw=1.2, label=label)
        ax.scatter(mean_pred, true_rate, s=12 + 140 * np.sqrt(counts / counts.max()), color=color, zorder=3)
    ax.plot([0, 1], [0, 1], ls="--", color="#64748b", lw=1, label="Perfect calibration")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Predicted failure probability (10 uniform bins)")
    ax.set_ylabel("Observed failure rate")
    ax.set_title("Calibration (marker area ~ machines in bin)")
    ax.legend(fontsize=8, loc="upper left")
    fig.tight_layout()
    fig.savefig(FIGURE_DIR / "ai4i_calibration.png", dpi=130)
    plt.close(fig)


def cost_figure(table: list[dict], frozen_threshold: float) -> None:
    df = pd.DataFrame(table)
    fig, ax1 = plt.subplots(figsize=(7, 4))
    ax1.plot(df["ratio"], df["threshold"], color="#2563eb", label="Cost-optimal threshold")
    ax1.axhline(frozen_threshold, color="#64748b", ls="--", lw=1, label=f"Frozen threshold {frozen_threshold:.3f}")
    ax1.set_xscale("log")
    ax1.set_xlabel("Cost of a missed failure ÷ cost of a false alarm")
    ax1.set_ylabel("Threshold (chosen out-of-fold)")
    ax2 = ax1.twinx()
    ax2.plot(df["ratio"], df["missed_failures"], color="#dc2626", label="Test missed failures")
    ax2.plot(df["ratio"], df["false_alarms"], color="#f59e0b", label="Test false alarms")
    ax2.set_ylabel("Test machines (of 1,500)")
    handles = ax1.get_legend_handles_labels()[0] + ax2.get_legend_handles_labels()[0]
    ax1.legend(handles, [h.get_label() for h in handles], fontsize=8, loc="center left")
    ax1.set_title("Cost-based threshold")
    fig.tight_layout()
    fig.savefig(FIGURE_DIR / "ai4i_cost_threshold.png", dpi=130)
    plt.close(fig)


def export_test_machines(raw_test: pd.DataFrame, report: dict) -> None:
    """Held-out machines and outcomes for the dashboard's performance view.

    The browser re-scores them with its own copy of the forest, so the view
    follows whatever threshold the decision policy sets.
    """
    columns = ["Type", "Air temperature [K]", "Process temperature [K]", "Rotational speed [rpm]", "Torque [Nm]", "Tool wear [min]"]
    rows = [
        [r["Type"], *[float(r[c]) for c in columns[1:]], int(r[TARGET]), ",".join(m for m in MODES if r[m] == 1)]
        for _, r in raw_test.iterrows()
    ]
    model, rules = report["model"], report["rule_baseline"]["deterministic_rules"]
    WEB_TEST_PATH.write_text(json.dumps({
        "version": 1,
        "columns": ["type", "airTemperature", "processTemperature", "rotationalSpeed", "torque", "toolWear", "failed", "modes"],
        "rows": rows,
        "summary": {
            "prAuc": model["pr_auc"], "prAuc95ci": report["model_95ci"]["pr_auc"],
            "brier": model["brier"], "brierBaseRate": model["brier_base_rate"],
            "ece": report["calibration"]["ece_test"],
            "modelF1": model["f1"], "rulesF1": rules["f1"],
            "rulesPrecision": rules["precision"], "rulesRecall": rules["recall"],
        },
    }, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    model = joblib.load(MODEL_PATH)
    contract = json.loads(METADATA_PATH.read_text("utf-8"))
    features, threshold = contract["features"], float(contract["threshold"])

    raw_dev = pd.concat([pd.read_csv(DATA_DIR / f"{split}.csv") for split in ["train", "validation"]], ignore_index=True)
    raw_test = pd.read_csv(DATA_DIR / "test.csv")
    X_dev, y_dev = engineer(raw_dev, features), raw_dev[TARGET].to_numpy()
    X_test, y_test = engineer(raw_test, features), raw_test[TARGET].to_numpy()

    prob_test = model.predict_proba(X_test)[:, 1]
    flagged = prob_test >= threshold
    print("Out-of-fold predictions on 8,500 development rows (5-fold, stratified)...")
    oof = cross_val_predict(
        clone(model), X_dev, y_dev, method="predict_proba",
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED),
    )[:, 1]

    base_rate = float(y_dev.mean())
    model_test = {
        "pr_auc": float(average_precision_score(y_test, prob_test)),
        "roc_auc": float(roc_auc_score(y_test, prob_test)),
        "brier": float(brier_score_loss(y_test, prob_test)),
        "brier_base_rate": float(brier_score_loss(y_test, np.full(len(y_test), base_rate))),
        "threshold": threshold,
        **classification(y_test, flagged),
    }
    rules = {
        "deterministic_rules": classification(y_test, rule_baseline(raw_test)),
        "rules_plus_tool_wear_200": classification(y_test, rule_baseline(raw_test, include_tool_wear=True)),
    }
    modes = raw_test.loc[y_test == 1, MODES]
    recall_by_mode = {
        mode: {"failures": int(modes[mode].sum()), "caught": int(flagged[y_test == 1][modes[mode].to_numpy() == 1].sum())}
        for mode in MODES
    }

    table = cost_table(y_dev, oof, y_test, prob_test)
    report = {
        "test_rows": int(len(y_test)),
        "test_failures": int(y_test.sum()),
        "model": model_test,
        "model_95ci": bootstrap(y_test, prob_test, threshold),
        "rule_baseline": rules,
        "recall_by_failure_mode": recall_by_mode,
        "shap": shap_rule_figure(model, X_test, raw_test),
        "calibration": {
            "mean_predicted_test": float(prob_test.mean()),
            "observed_rate_test": float(y_test.mean()),
            "brier_oof": float(brier_score_loss(y_dev, oof)),
            "ece_test": expected_calibration_error(y_test, prob_test),
            "ece_oof": expected_calibration_error(y_dev, oof),
        },
        "cost_thresholds": [row for row in table if row["ratio"] in REPORTED_RATIOS],
        "threshold_selection": "minimum ratio x missed + false alarms on out-of-fold development predictions",
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    calibration_figure(y_test, prob_test, y_dev, oof)
    cost_figure(table, threshold)
    POLICY_PATH.write_text(json.dumps({
        "selection": report["threshold_selection"],
        "thresholds": {str(row["ratio"]): row["threshold"] for row in table},
    }, indent=2), encoding="utf-8")
    WEB_PATH.write_text(json.dumps({
        "version": 1,
        "frozenThreshold": threshold,
        "frozen": {"threshold": threshold, **{k: model_test[k] for k in ["flagged", "missed_failures", "false_alarms", "precision", "recall"]}},
        "testRows": int(len(y_test)),
        "testFailures": int(y_test.sum()),
        "ratios": table,
    }, separators=(",", ":")), encoding="utf-8")

    export_test_machines(raw_test, report)

    ci = report["model_95ci"]
    print(f"\nTest ({len(y_test)} machines, {int(y_test.sum())} failures), frozen threshold {threshold:.3f}:")
    print(f"  PR-AUC {model_test['pr_auc']:.3f} ({ci['pr_auc'][0]:.3f}-{ci['pr_auc'][1]:.3f})")
    print(f"  precision {model_test['precision']:.3f} ({ci['precision'][0]:.3f}-{ci['precision'][1]:.3f})"
          f"  recall {model_test['recall']:.3f} ({ci['recall'][0]:.3f}-{ci['recall'][1]:.3f})")
    print(f"  Brier {model_test['brier']:.4f} (base-rate {model_test['brier_base_rate']:.4f})")
    for name, result in rules.items():
        print(f"  {name}: precision {result['precision']:.3f} recall {result['recall']:.3f}")
    print("  recall by mode:", {m: f"{v['caught']}/{v['failures']}" for m, v in recall_by_mode.items()})
    for row in report["cost_thresholds"]:
        print(f"  ratio {row['ratio']:>3}: threshold {row['threshold']:.3f}  missed {row['missed_failures']}  false alarms {row['false_alarms']}")
    print(f"Wrote {REPORT_PATH.relative_to(PROJECT_ROOT)}, figures, and {WEB_PATH.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
