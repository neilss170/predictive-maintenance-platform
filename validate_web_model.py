"""Check the compact browser forest against sklearn probabilities."""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd


root = Path(__file__).resolve().parent
pipeline = joblib.load(root / "models" / "final_governed_pipeline.joblib")
web_model = json.loads(
    (root / "dashboard" / "public" / "model.json").read_text(encoding="utf-8")
)
data = pd.read_csv(root / "data" / "raw" / "ai4i2020.csv").sample(
    200, random_state=42
)
features = data[
    [
        "Type",
        "Air temperature [K]",
        "Process temperature [K]",
        "Rotational speed [rpm]",
        "Torque [Nm]",
        "Tool wear [min]",
    ]
].copy()
features["Temperature difference [K]"] = (
    features["Process temperature [K]"] - features["Air temperature [K]"]
)
features["Mechanical power [W]"] = (
    2
    * np.pi
    * features["Rotational speed [rpm]"]
    * features["Torque [Nm]"]
    / 60
)
features[pipeline.named_steps["pre"].feature_names_in_[-1]] = (
    features["Torque [Nm]"] * features["Tool wear [min]"]
)


def browser_probability(row):
    numeric = np.array(
        [
            row["Air temperature [K]"],
            row["Process temperature [K]"],
            row["Rotational speed [rpm]"],
            row["Torque [Nm]"],
            row["Tool wear [min]"],
            row["Temperature difference [K]"],
            row["Mechanical power [W]"],
            row[pipeline.named_steps["pre"].feature_names_in_[-1]],
        ],
        dtype=float,
    )
    vector = np.asarray(
        (numeric - web_model["means"]) / web_model["scales"], dtype=np.float32
    ).tolist()
    vector.extend(
        int(category == row["Type"]) for category in web_model["typeCategories"]
    )

    probability = 0.0
    for tree in web_model["trees"]:
        node = 0
        while tree["l"][node] != -1:
            node = (
                tree["l"][node]
                if vector[tree["f"][node]] <= tree["t"][node]
                else tree["r"][node]
            )
        probability += tree["p"][node]
    return probability / len(web_model["trees"])


python_probabilities = pipeline.predict_proba(features)[:, 1]
browser_probabilities = np.array(
    [browser_probability(row) for _, row in features.iterrows()]
)
maximum_error = np.max(np.abs(python_probabilities - browser_probabilities))
if maximum_error >= 1e-7:
    index = int(np.argmax(np.abs(python_probabilities - browser_probabilities)))
    transformed = pipeline.named_steps["pre"].transform(features.iloc[[index]])
    row = features.iloc[index]
    numeric = np.array(
        [
            row["Air temperature [K]"],
            row["Process temperature [K]"],
            row["Rotational speed [rpm]"],
            row["Torque [Nm]"],
            row["Tool wear [min]"],
            row["Temperature difference [K]"],
            row["Mechanical power [W]"],
            row[pipeline.named_steps["pre"].feature_names_in_[-1]],
        ]
    )
    manual_vector = np.asarray(
        (numeric - web_model["means"]) / web_model["scales"], dtype=np.float32
    ).tolist()
    manual_vector.extend(
        int(category == row["Type"]) for category in web_model["typeCategories"]
    )
    print(
        "Largest discrepancy:",
        index,
        python_probabilities[index],
        browser_probabilities[index],
    )
    print("Transform max error:", np.max(np.abs(transformed - manual_vector)))
    estimator_probabilities = np.array(
        [
            estimator.predict_proba(transformed)[0, 1]
            for estimator in pipeline.named_steps["model"].estimators_
        ]
    )
    exported_tree_probabilities = []
    for tree in web_model["trees"]:
        node = 0
        while tree["l"][node] != -1:
            node = (
                tree["l"][node]
                if manual_vector[tree["f"][node]] <= tree["t"][node]
                else tree["r"][node]
            )
        exported_tree_probabilities.append(tree["p"][node])
    tree_errors = np.abs(
        estimator_probabilities - np.array(exported_tree_probabilities)
    )
    print(
        "Tree max error:",
        tree_errors.max(),
        "mismatched trees:",
        int((tree_errors > 1e-9).sum()),
    )
assert maximum_error < 1e-7, maximum_error
print(f"Web model parity PASS; maximum absolute error={maximum_error:.3e}")
