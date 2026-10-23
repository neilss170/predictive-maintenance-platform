import json
import unittest
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from ai4i.evaluate import classification, cost_threshold, engineer
from ai4i.rules import rule_modes

ROOT = Path(__file__).resolve().parents[1]


class RuleTests(unittest.TestCase):
    def test_deterministic_rules_reproduce_dataset_labels(self):
        raw = pd.read_csv(ROOT / "data/raw/ai4i2020.csv", encoding="utf-8-sig")
        modes = rule_modes(raw)
        for mode in ["HDF", "PWF", "OSF"]:
            np.testing.assert_array_equal(modes[mode].to_numpy(), raw[mode].to_numpy() == 1, mode)


class CostThresholdTests(unittest.TestCase):
    def test_threshold_minimises_weighted_cost(self):
        y = np.array([0, 0, 1, 0, 1, 1])
        prob = np.array([0.1, 0.2, 0.3, 0.4, 0.8, 0.9])
        # Equal costs: flag the top two (one miss at 0.3, no false alarms).
        self.assertTrue(0.4 < cost_threshold(y, prob, 1) <= 0.8)
        # Misses ten times worse: flag down to 0.3 and accept one false alarm.
        self.assertTrue(0.2 < cost_threshold(y, prob, 10) <= 0.3)

    def test_web_curve_threshold_falls_as_misses_get_costlier(self):
        curve = json.loads((ROOT / "dashboard/public/cost-curve.json").read_text("utf-8"))
        thresholds = [row["threshold"] for row in curve["ratios"]]
        self.assertEqual([row["ratio"] for row in curve["ratios"]], list(range(1, 101)))
        self.assertTrue(all(a >= b for a, b in zip(thresholds, thresholds[1:])))


class FrozenThresholdTests(unittest.TestCase):
    def test_contract_threshold_reproduces_reported_test_metrics(self):
        contract = json.loads((ROOT / "models/governed_model_contract.json").read_text("utf-8"))
        reported = json.loads((ROOT / "reports/final_governed_test_metrics.json").read_text("utf-8"))
        web = json.loads((ROOT / "dashboard/public/model.json").read_text("utf-8"))
        test = pd.read_csv(ROOT / "data/governed/test.csv")
        prob = joblib.load(ROOT / "models/final_governed_pipeline.joblib").predict_proba(
            engineer(test, contract["features"])
        )[:, 1]
        result = classification(test["Machine failure"].to_numpy(), prob >= contract["threshold"])
        self.assertAlmostEqual(result["precision"], reported["precision"])
        self.assertAlmostEqual(result["recall"], reported["recall"])
        self.assertEqual(web["decisionThreshold"], contract["threshold"])


if __name__ == "__main__":
    unittest.main()
