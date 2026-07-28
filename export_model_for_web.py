"""Export the fitted sklearn pipeline to a compact browser-evaluable JSON model."""

import json
from pathlib import Path

import joblib
import numpy as np


root = Path(__file__).resolve().parent
pipeline = joblib.load(root / "models" / "final_governed_pipeline.joblib")
metadata = json.loads(
    (root / "models" / "governed_model_contract.json").read_text("utf-8")
)
metrics = json.loads((root / "reports" / "final_governed_test_metrics.json").read_text("utf-8"))

preprocess = pipeline.named_steps["pre"]
forest = pipeline.named_steps["model"]
scaler = preprocess.named_transformers_["n"]
encoder = preprocess.named_transformers_["c"]


def compact_float(value):
    return float(value)


trees = []
for estimator in forest.estimators_:
    tree = estimator.tree_
    positive_probability = []
    for node_value in tree.value[:, 0, :]:
        total = float(node_value.sum())
        positive_probability.append(
            compact_float(node_value[1] / total) if total else 0.0
        )
    trees.append(
        {
            "l": tree.children_left.astype(int).tolist(),
            "r": tree.children_right.astype(int).tolist(),
            "f": tree.feature.astype(int).tolist(),
            "t": [compact_float(value) for value in tree.threshold],
            "p": positive_probability,
        }
    )

web_model = {
    "version": 1,
    "modelName": metadata["model"],
    "decisionThreshold": compact_float(metadata["threshold"]),
    "numericFeatures": list(scaler.feature_names_in_),
    "means": [compact_float(value) for value in scaler.mean_],
    "scales": [compact_float(value) for value in scaler.scale_],
    "typeCategories": encoder.categories_[0].tolist(),
    "trees": trees,
    "metrics": {
        "testPrAuc": metrics["pr_auc"],
        "testRocAuc": metrics["roc_auc"],
        "testPrecision": metrics["precision"],
        "testRecall": metrics["recall"],
    },
    "warning": "Synthetic AI4I benchmark only; not approved for production maintenance decisions.",
}

output = root / "dashboard" / "public" / "model.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(web_model, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {output} ({output.stat().st_size / 1_000_000:.2f} MB)")
