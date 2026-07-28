"""Run one leakage-safe predictive-maintenance inference from the command line."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parent
MODEL_PATH = PROJECT_ROOT / "models" / "final_governed_pipeline.joblib"
METADATA_PATH = PROJECT_ROOT / "models" / "governed_model_contract.json"
VALID_TYPES = {"L", "M", "H"}


def build_feature_row(args: argparse.Namespace) -> pd.DataFrame:
    """Create the exact feature schema used by the fitted pipeline."""
    product_type = args.type.upper()
    if product_type not in VALID_TYPES:
        raise ValueError(f"type must be one of {sorted(VALID_TYPES)}")

    numeric_values = {
        "air_temperature": args.air_temperature,
        "process_temperature": args.process_temperature,
        "rotational_speed": args.rotational_speed,
        "torque": args.torque,
        "tool_wear": args.tool_wear,
    }
    if not all(np.isfinite(value) for value in numeric_values.values()):
        raise ValueError("all numeric inputs must be finite")
    if args.rotational_speed < 0 or args.torque < 0 or args.tool_wear < 0:
        raise ValueError("rotational speed, torque, and tool wear must be non-negative")

    temperature_difference = args.process_temperature - args.air_temperature
    mechanical_power = 2 * np.pi * args.rotational_speed * args.torque / 60
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    interaction_name = metadata["features"][-1]

    return pd.DataFrame(
        [
            {
                "Type": product_type,
                "Air temperature [K]": args.air_temperature,
                "Process temperature [K]": args.process_temperature,
                "Rotational speed [rpm]": args.rotational_speed,
                "Torque [Nm]": args.torque,
                "Tool wear [min]": args.tool_wear,
                "Temperature difference [K]": temperature_difference,
                "Mechanical power [W]": mechanical_power,
                interaction_name: args.torque * args.tool_wear,
            }
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score one AI4I-format machine observation."
    )
    parser.add_argument("--type", required=True, help="Product type: L, M, or H")
    parser.add_argument("--air-temperature", type=float, required=True, help="Kelvin")
    parser.add_argument(
        "--process-temperature", type=float, required=True, help="Kelvin"
    )
    parser.add_argument(
        "--rotational-speed", type=float, required=True, help="Revolutions per minute"
    )
    parser.add_argument("--torque", type=float, required=True, help="Newton-metres")
    parser.add_argument("--tool-wear", type=float, required=True, help="Minutes")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not MODEL_PATH.exists() or not METADATA_PATH.exists():
        raise FileNotFoundError(
            "Model artifacts are missing. Execute "
            "notebook/04_modeling.ipynb first."
        )

    model = joblib.load(MODEL_PATH)
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    feature_row = build_feature_row(args)

    expected_features = metadata["features"]
    if feature_row.columns.tolist() != expected_features:
        raise RuntimeError("Inference feature schema does not match model metadata")

    failure_probability = float(model.predict_proba(feature_row)[0, 1])
    threshold = float(metadata["threshold"])
    prediction = int(failure_probability >= threshold)

    result = {
        "prediction": prediction,
        "prediction_label": "Failure risk" if prediction else "No failure risk",
        "failure_probability": round(failure_probability, 6),
        "decision_threshold": round(threshold, 6),
        "model_name": metadata["model"],
        "warning": "Synthetic benchmark only; not approved for production maintenance decisions.",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
