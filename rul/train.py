"""Select, fit and evaluate the FD001 remaining-useful-life model.

Model selection uses five-fold GroupKFold over training engines, so no engine
contributes rows to both sides of a fold. The official test set (100 engines
truncated before failure, scored at their last observed cycle) is used once,
after the model is chosen.

    python -m rul.train
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from rul.data import PROJECT_ROOT, RUL_CAP, SENSORS, load_test, load_train
from rul.features import (
    BASELINE_CYCLES,
    ROLLING_WINDOW,
    SLOPE_WINDOW,
    build_features,
    feature_names,
)


MODEL_PATH = PROJECT_ROOT / "models" / "rul_model.joblib"
CONTRACT_PATH = PROJECT_ROOT / "models" / "rul_model_contract.json"
METRICS_PATH = PROJECT_ROOT / "reports" / "rul_test_metrics.json"
CV_PATH = PROJECT_ROOT / "reports" / "rul_cv_comparison.csv"
WEB_PATH = PROJECT_ROOT / "dashboard" / "public" / "rul-fleet.json"

SEED = 42
ALARM_CYCLES = 30  # "fail within 30 cycles" is the maintenance alarm being evaluated
RISK_BANDS = {"severe": 30, "warning": 70}  # predicted RUL at or below each bound


def candidates() -> dict:
    return {
        "Mean baseline": DummyRegressor(strategy="mean"),
        "Ridge regression": make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
        "Random forest": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=5, max_features=0.33, n_jobs=-1, random_state=SEED
        ),
        "Gradient boosting": HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40,
            l2_regularization=1.0, random_state=SEED,
        ),
        "Gradient boosting (shallow)": HistGradientBoostingRegressor(
            max_iter=600, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=80,
            l2_regularization=1.0, random_state=SEED,
        ),
    }


def rmse(y_true, y_pred) -> float:
    return float(np.sqrt(np.mean((np.asarray(y_pred) - np.asarray(y_true)) ** 2)))


def nasa_score(y_true, y_pred) -> float:
    """PHM08 asymmetric score: late predictions (overestimates) cost more than early ones."""
    d = np.asarray(y_pred) - np.asarray(y_true)
    return float(np.sum(np.where(d < 0, np.exp(-d / 13) - 1, np.exp(d / 10) - 1)))


def cross_validate(X: pd.DataFrame, y: pd.Series, groups: pd.Series) -> pd.DataFrame:
    rows = []
    folds = list(GroupKFold(n_splits=5).split(X, y, groups))
    for name, estimator in candidates().items():
        fold_rmse = []
        for train_idx, valid_idx in folds:
            model = clone(estimator).fit(X.iloc[train_idx], y.iloc[train_idx])
            prediction = np.clip(model.predict(X.iloc[valid_idx]), 0, RUL_CAP)
            fold_rmse.append(rmse(y.iloc[valid_idx], prediction))
        rows.append({"model": name, "cv_rmse_mean": np.mean(fold_rmse), "cv_rmse_std": np.std(fold_rmse)})
        print(f"  {name:<28} CV RMSE {np.mean(fold_rmse):6.2f} ± {np.std(fold_rmse):.2f}")
    return pd.DataFrame(rows).sort_values("cv_rmse_mean").reset_index(drop=True)


def bootstrap_interval(y_true, y_pred, metric, n=2000) -> list[float]:
    rng = np.random.default_rng(SEED)
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    samples = [metric(y_true[idx], y_pred[idx]) for idx in rng.integers(0, len(y_true), (n, len(y_true)))]
    return [float(np.percentile(samples, 2.5)), float(np.percentile(samples, 97.5))]


def alarm_metrics(y_true, y_pred) -> dict:
    actual = np.asarray(y_true) <= ALARM_CYCLES
    raised = np.asarray(y_pred) <= ALARM_CYCLES
    tp = int(np.sum(actual & raised))
    return {
        "alarm_cycles": ALARM_CYCLES,
        "engines_due": int(actual.sum()),
        "alarms_raised": int(raised.sum()),
        "true_alarms": tp,
        "precision": tp / raised.sum() if raised.sum() else 0.0,
        "recall": tp / actual.sum() if actual.sum() else 0.0,
    }


def evaluate(y_true, y_pred) -> dict:
    return {
        "rmse": rmse(y_true, y_pred),
        "mae": float(np.mean(np.abs(np.asarray(y_pred) - np.asarray(y_true)))),
        "nasa_score": nasa_score(y_true, y_pred),
    }


def export_web_fleet(model, test_features: pd.DataFrame, features: list[str], metrics: dict) -> None:
    """Per-cycle predictions for every test engine, for the dashboard's playback view."""
    scored = test_features.assign(pred=np.clip(model.predict(test_features[features]), 0, RUL_CAP))
    engines = []
    for unit, engine in scored.groupby("unit"):
        engines.append({
            "unit": int(unit),
            "cycles": engine["cycle"].astype(int).tolist(),
            "predicted": engine["pred"].round(1).tolist(),
            "actual": engine["rul"].astype(int).tolist(),
            "sensors": {s: engine[s].round(4).tolist() for s in ["sensor_4", "sensor_11", "sensor_15"]},
        })
    payload = {
        "version": 1,
        "rulCap": RUL_CAP,
        "riskBands": RISK_BANDS,
        "metrics": metrics,
        "engines": engines,
    }
    WEB_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {WEB_PATH.relative_to(PROJECT_ROOT)} ({WEB_PATH.stat().st_size / 1000:.0f} kB)")


def main() -> None:
    features = feature_names()
    train = build_features(load_train())
    test = build_features(load_test())
    X, y, groups = train[features], train["rul_capped"], train["unit"]

    print("Engine-grouped cross-validation on 100 training engines:")
    comparison = cross_validate(X, y, groups)
    best_name = comparison.loc[comparison["model"] != "Mean baseline", "model"].iloc[0]
    print(f"Selected: {best_name}")

    # Official test: one prediction per engine, at its last observed cycle.
    last = test.groupby("unit").tail(1)
    test_rows = {}
    fitted = {}
    for name, estimator in candidates().items():
        fitted[name] = clone(estimator).fit(X, y)
        prediction = np.clip(fitted[name].predict(last[features]), 0, RUL_CAP)
        test_rows[name] = {"official": evaluate(last["rul"], prediction),
                           "capped_truth": evaluate(last["rul_capped"], prediction)}
        if name == best_name:
            best_prediction = prediction
    comparison["test_rmse"] = comparison["model"].map(lambda m: test_rows[m]["official"]["rmse"])
    comparison["test_nasa_score"] = comparison["model"].map(lambda m: test_rows[m]["official"]["nasa_score"])
    comparison.to_csv(CV_PATH, index=False)

    model = fitted[best_name]
    official = test_rows[best_name]["official"]
    metrics = {
        "model": best_name,
        "test_engines": int(len(last)),
        **official,
        "rmse_95ci": bootstrap_interval(last["rul"], best_prediction, rmse),
        "capped_truth": test_rows[best_name]["capped_truth"],
        "alarm": alarm_metrics(last["rul"], best_prediction),
        "baselines": {name: rows["official"] for name, rows in test_rows.items() if name != best_name},
    }

    print(f"\nOfficial FD001 test ({len(last)} engines, last observed cycle):")
    print(f"  RMSE {official['rmse']:.2f}  (95% CI {metrics['rmse_95ci'][0]:.2f}-{metrics['rmse_95ci'][1]:.2f})")
    print(f"  MAE  {official['mae']:.2f}   NASA score {official['nasa_score']:.0f}")
    print(f"  RMSE vs truth capped at {RUL_CAP}: {metrics['capped_truth']['rmse']:.2f}")
    print(f"  {ALARM_CYCLES}-cycle alarm: precision {metrics['alarm']['precision']:.2f}, recall {metrics['alarm']['recall']:.2f}")

    joblib.dump(model, MODEL_PATH, compress=3)
    CONTRACT_PATH.write_text(json.dumps({
        "dataset": "NASA C-MAPSS FD001",
        "model": best_name,
        "estimator": type(model).__name__,
        "features": features,
        "sensors": SENSORS,
        "rul_cap": RUL_CAP,
        "rolling_window": ROLLING_WINDOW,
        "slope_window": SLOPE_WINDOW,
        "baseline_cycles": BASELINE_CYCLES,
        "risk_bands": RISK_BANDS,
        "selection": "5-fold GroupKFold by engine, lowest mean RMSE",
        "frozen_before_test": True,
    }, indent=2), encoding="utf-8")
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    export_web_fleet(model, test, features, {k: metrics[k] for k in ["model", "rmse", "mae", "nasa_score", "rmse_95ci", "alarm"]})


if __name__ == "__main__":
    main()
