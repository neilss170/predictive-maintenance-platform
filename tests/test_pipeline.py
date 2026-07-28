import argparse
import json
import unittest
from pathlib import Path

import joblib
import numpy as np

from predict import build_feature_row

ROOT = Path(__file__).resolve().parents[1]

class GovernedPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=json.loads((ROOT/"models/governed_model_contract.json").read_text("utf-8"))
        cls.pipeline=joblib.load(ROOT/"models/final_governed_pipeline.joblib")

    def args(self):
        return argparse.Namespace(type="L",air_temperature=298.1,process_temperature=308.6,rotational_speed=1551.0,torque=42.8,tool_wear=0.0)

    def test_schema_matches_contract(self):
        self.assertEqual(build_feature_row(self.args()).columns.tolist(),self.contract["features"])

    def test_probability_is_valid(self):
        p=self.pipeline.predict_proba(build_feature_row(self.args()))[0,1]
        self.assertTrue(np.isfinite(p) and 0 <= p <= 1)

    def test_leakage_is_absent(self):
        forbidden={"UDI","Product ID","Machine failure","TWF","HDF","PWF","OSF","RNF"}
        self.assertTrue(forbidden.isdisjoint(self.contract["features"]))

    def test_invalid_type_rejected(self):
        args=self.args(); args.type="X"
        with self.assertRaises(ValueError): build_feature_row(args)

if __name__=="__main__": unittest.main()
