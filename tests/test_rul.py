import json
import unittest
from pathlib import Path

import joblib
import numpy as np

from rul.data import RUL_CAP, load_test, load_train
from rul.features import build_features, feature_names
from rul.train import nasa_score

ROOT = Path(__file__).resolve().parents[1]


class RulDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.train = load_train()
        cls.test = load_test()

    def test_train_engines_end_at_zero_rul(self):
        last = self.train.groupby("unit").tail(1)
        self.assertEqual(len(last), 100)
        self.assertTrue((last["rul"] == 0).all())

    def test_target_is_capped(self):
        self.assertEqual(self.train["rul_capped"].max(), RUL_CAP)
        self.assertTrue((self.train["rul_capped"] <= self.train["rul"]).all())

    def test_test_rul_matches_official_file(self):
        official = np.loadtxt(ROOT / "data/turbofan/RUL_FD001.txt")
        last = self.test.groupby("unit").tail(1)
        np.testing.assert_array_equal(last["rul"].to_numpy(), official)


class RulFeatureTests(unittest.TestCase):
    def test_features_are_causal(self):
        """Truncating future cycles must not change any earlier feature value."""
        train = load_train()
        names = feature_names()
        full = build_features(train)
        partial = build_features(train[train["cycle"] <= 40])
        np.testing.assert_allclose(
            full.loc[full["cycle"] <= 40, names].to_numpy(), partial[names].to_numpy()
        )

    def test_no_target_columns_in_features(self):
        self.assertFalse([name for name in feature_names() if "rul" in name])

    def test_missing_sensor_rejected(self):
        with self.assertRaises(ValueError):
            build_features(load_train().drop(columns="sensor_11"))


class RulModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads((ROOT / "models/rul_model_contract.json").read_text("utf-8"))
        cls.model = joblib.load(ROOT / "models/rul_model.joblib")
        cls.metrics = json.loads((ROOT / "reports/rul_test_metrics.json").read_text("utf-8"))

    def test_contract_matches_feature_builder(self):
        self.assertEqual(self.contract["features"], feature_names())

    def test_predictions_on_test_engines_are_plausible(self):
        last = build_features(load_test()).groupby("unit").tail(1)
        prediction = self.model.predict(last[self.contract["features"]])
        self.assertTrue(np.isfinite(prediction).all())
        self.assertLess(np.sqrt(np.mean((np.clip(prediction, 0, RUL_CAP) - last["rul"]) ** 2)), 16)

    def test_reported_model_beats_baselines(self):
        for name, baseline in self.metrics["baselines"].items():
            if name.startswith("Gradient"):
                continue
            self.assertLess(self.metrics["rmse"], baseline["rmse"], name)

    def test_nasa_score_penalises_late_predictions(self):
        self.assertGreater(nasa_score([50], [60]), nasa_score([50], [40]))
        self.assertEqual(nasa_score([50], [50]), 0.0)


if __name__ == "__main__":
    unittest.main()
