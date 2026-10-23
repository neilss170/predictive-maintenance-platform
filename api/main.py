"""One HTTP service for both models: AI4I failure risk and FD001 remaining useful life.

    uvicorn api.main:app --reload
"""

from __future__ import annotations

import json
from functools import lru_cache
from types import SimpleNamespace
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from predict import METADATA_PATH, MODEL_PATH, build_feature_row
from rul.data import PROJECT_ROOT, RUL_CAP
from rul.features import build_features


RUL_MODEL_PATH = PROJECT_ROOT / "models" / "rul_model.joblib"
RUL_CONTRACT_PATH = PROJECT_ROOT / "models" / "rul_model_contract.json"
RUL_METRICS_PATH = PROJECT_ROOT / "reports" / "rul_test_metrics.json"
FAILURE_METRICS_PATH = PROJECT_ROOT / "reports" / "final_governed_test_metrics.json"
MAX_BATCH = 5000
MAX_CYCLES = 1000

app = FastAPI(
    title="Predictive Maintenance API",
    description=(
        "Failure-risk classification (UCI AI4I 2020, synthetic) and remaining-useful-life "
        "regression (NASA C-MAPSS FD001). Outputs support human maintenance review."
    ),
    version="2.0.0",
)


@lru_cache
def failure_model():
    return joblib.load(MODEL_PATH), json.loads(METADATA_PATH.read_text("utf-8"))


@lru_cache
def rul_model():
    return joblib.load(RUL_MODEL_PATH), json.loads(RUL_CONTRACT_PATH.read_text("utf-8"))


class MachineReading(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["L", "M", "H"]
    air_temperature: float = Field(gt=0, description="Kelvin")
    process_temperature: float = Field(gt=0, description="Kelvin")
    rotational_speed: float = Field(ge=0, description="rpm")
    torque: float = Field(ge=0, description="Nm")
    tool_wear: float = Field(ge=0, description="minutes")


class FailureRisk(BaseModel):
    failure_probability: float
    decision_threshold: float
    flagged: bool


class FailureBatch(BaseModel):
    machines: list[MachineReading] = Field(min_length=1, max_length=MAX_BATCH)


class EngineCycle(BaseModel):
    """One cycle of sensor history. Extra sensors (the flat FD001 channels) are ignored."""

    model_config = ConfigDict(extra="ignore")

    cycle: int = Field(ge=1)
    sensor_2: float
    sensor_3: float
    sensor_4: float
    sensor_7: float
    sensor_8: float
    sensor_9: float
    sensor_11: float
    sensor_12: float
    sensor_13: float
    sensor_14: float
    sensor_15: float
    sensor_17: float
    sensor_20: float
    sensor_21: float


class EngineHistory(BaseModel):
    history: list[EngineCycle] = Field(min_length=1, max_length=MAX_CYCLES)

    @model_validator(mode="after")
    def cycles_increase(self):
        cycles = [row.cycle for row in self.history]
        if cycles != sorted(set(cycles)):
            raise ValueError("cycles must be unique and in increasing order")
        return self


class RulPrediction(BaseModel):
    predicted_rul: float = Field(description="Cycles, capped at the training horizon")
    rul_cap: int
    risk_band: Literal["severe", "warning", "healthy"]
    cycles_observed: int
    note: str | None = None


def score_failures(readings: list[MachineReading]) -> list[FailureRisk]:
    model, metadata = failure_model()
    rows = pd.concat(
        [build_feature_row(SimpleNamespace(**reading.model_dump())) for reading in readings],
        ignore_index=True,
    )
    probabilities = model.predict_proba(rows[metadata["features"]])[:, 1]
    threshold = float(metadata["threshold"])
    return [
        FailureRisk(failure_probability=round(float(p), 6), decision_threshold=round(threshold, 6), flagged=bool(p >= threshold))
        for p in probabilities
    ]


@app.get("/health")
def health() -> dict:
    failure_model()
    rul_model()
    return {"status": "ok", "models": ["failure-risk", "rul"]}


@app.get("/v1/models")
def models() -> dict:
    _, failure_contract = failure_model()
    _, rul_contract = rul_model()
    return {
        "failure_risk": {
            "dataset": "UCI AI4I 2020 (synthetic)",
            "contract": failure_contract,
            "test_metrics": json.loads(FAILURE_METRICS_PATH.read_text("utf-8")),
        },
        "rul": {
            "dataset": rul_contract["dataset"],
            "contract": rul_contract,
            "test_metrics": json.loads(RUL_METRICS_PATH.read_text("utf-8")),
        },
    }


@app.post("/v1/failure-risk", response_model=FailureRisk)
def failure_risk(reading: MachineReading) -> FailureRisk:
    return score_failures([reading])[0]


@app.post("/v1/failure-risk/batch", response_model=list[FailureRisk])
def failure_risk_batch(batch: FailureBatch) -> list[FailureRisk]:
    return score_failures(batch.machines)


@app.post("/v1/rul", response_model=RulPrediction)
def remaining_useful_life(engine: EngineHistory) -> RulPrediction:
    model, contract = rul_model()
    history = pd.DataFrame([row.model_dump() for row in engine.history]).assign(unit=0)
    features = build_features(history)
    latest = features.tail(1)[contract["features"]]
    if not np.isfinite(latest.to_numpy()).all():
        raise HTTPException(status_code=422, detail="sensor history produced non-finite features")

    predicted = float(np.clip(model.predict(latest)[0], 0, RUL_CAP))
    bands = contract["risk_bands"]
    band = "severe" if predicted <= bands["severe"] else "warning" if predicted <= bands["warning"] else "healthy"
    note = None
    if len(engine.history) < contract["slope_window"]:
        note = f"Fewer than {contract['slope_window']} cycles observed; trend features are still warming up."
    return RulPrediction(
        predicted_rul=round(predicted, 1),
        rul_cap=RUL_CAP,
        risk_band=band,
        cycles_observed=len(engine.history),
        note=note,
    )
