import json
import unittest

from fastapi.testclient import TestClient

from api.main import EngineCycle, app
from rul.data import SENSORS, load_test


HEALTHY = {
    "type": "L", "air_temperature": 298.1, "process_temperature": 308.6,
    "rotational_speed": 1551, "torque": 42.8, "tool_wear": 0,
}
STRESSED = {
    "type": "L", "air_temperature": 300.7, "process_temperature": 310.5,
    "rotational_speed": 1370, "torque": 65, "tool_wear": 220,
}


def engine_history(unit: int, last_cycle: int | None = None) -> list[dict]:
    test = load_test()
    engine = test[test["unit"] == unit]
    if last_cycle is not None:
        engine = engine[engine["cycle"] <= last_cycle]
    return engine[["cycle", *SENSORS]].to_dict("records")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_request_schema_lists_every_model_sensor(self):
        self.assertEqual([f for f in EngineCycle.model_fields if f != "cycle"], SENSORS)

    def test_health(self):
        self.assertEqual(self.client.get("/health").json()["status"], "ok")

    def test_models_reports_both_contracts(self):
        body = self.client.get("/v1/models").json()
        self.assertIn("threshold", body["failure_risk"]["contract"])
        self.assertEqual(body["rul"]["contract"]["rul_cap"], 125)

    def test_failure_risk_separates_scenarios(self):
        healthy = self.client.post("/v1/failure-risk", json=HEALTHY).json()
        stressed = self.client.post("/v1/failure-risk", json=STRESSED).json()
        self.assertFalse(healthy["flagged"])
        self.assertTrue(stressed["flagged"])

    def test_failure_risk_rejects_leakage_columns(self):
        response = self.client.post("/v1/failure-risk", json={**HEALTHY, "TWF": 0})
        self.assertEqual(response.status_code, 422)

    def test_failure_risk_rejects_non_finite_and_absurd_values(self):
        for value in ["NaN", "Infinity", "1e308"]:
            body = json.dumps({**HEALTHY, "torque": 0}).replace('"torque": 0', f'"torque": {value}')
            response = self.client.post("/v1/failure-risk", content=body, headers={"content-type": "application/json"})
            self.assertEqual(response.status_code, 422, value)

    def test_failure_risk_rejects_unknown_type(self):
        response = self.client.post("/v1/failure-risk", json={**HEALTHY, "type": "X"})
        self.assertEqual(response.status_code, 422)

    def test_batch_matches_single(self):
        batch = self.client.post("/v1/failure-risk/batch", json={"machines": [HEALTHY, STRESSED]}).json()
        single = self.client.post("/v1/failure-risk", json=STRESSED).json()
        self.assertEqual(batch[1], single)

    def test_cost_ratio_selects_policy_threshold(self):
        frozen = self.client.post("/v1/failure-risk", json=HEALTHY).json()
        costly_misses = self.client.post("/v1/failure-risk?cost_ratio=100", json=HEALTHY).json()
        self.assertLess(costly_misses["decision_threshold"], frozen["decision_threshold"])
        self.assertEqual(costly_misses["failure_probability"], frozen["failure_probability"])

    def test_cost_ratio_out_of_range_rejected(self):
        for ratio in [0, 101]:
            response = self.client.post(f"/v1/failure-risk?cost_ratio={ratio}", json=HEALTHY)
            self.assertEqual(response.status_code, 422)

    def test_rul_for_test_engine(self):
        # Engine 1 of the official test set has 31 cycles and a true RUL of 112.
        body = self.client.post("/v1/rul", json={"history": engine_history(1)}).json()
        self.assertEqual(body["cycles_observed"], 31)
        self.assertGreater(body["predicted_rul"], 80)
        self.assertEqual(body["risk_band"], "healthy")

    def test_rul_short_history_carries_note(self):
        body = self.client.post("/v1/rul", json={"history": engine_history(1, last_cycle=5)}).json()
        self.assertIsNotNone(body["note"])

    def test_rul_rejects_unordered_cycles(self):
        history = engine_history(1, last_cycle=5)[::-1]
        self.assertEqual(self.client.post("/v1/rul", json={"history": history}).status_code, 422)

    def test_rul_rejects_missing_sensor(self):
        history = engine_history(1, last_cycle=5)
        for row in history:
            del row["sensor_11"]
        self.assertEqual(self.client.post("/v1/rul", json={"history": history}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
