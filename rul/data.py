"""Load the C-MAPSS FD001 files and build the remaining-useful-life target."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data" / "turbofan"

COLUMNS = (
    ["unit", "cycle"]
    + [f"setting_{i}" for i in range(1, 4)]
    + [f"sensor_{i}" for i in range(1, 22)]
)

# FD001 has one operating condition, so the settings and these seven sensors are
# constant (or numerically flat) across the whole fleet and carry no signal.
FLAT_SENSORS = ["sensor_1", "sensor_5", "sensor_6", "sensor_10", "sensor_16", "sensor_18", "sensor_19"]
SENSORS = [f"sensor_{i}" for i in range(1, 22) if f"sensor_{i}" not in FLAT_SENSORS]

# Piecewise-linear target: an engine is treated as healthy until its last
# RUL_CAP cycles. This is the convention used across the FD001 literature.
RUL_CAP = 125


def _read(file_name: str) -> pd.DataFrame:
    path = DATA_DIR / file_name
    if not path.exists():
        raise FileNotFoundError(f"Turbofan file not found: {path}")
    return pd.read_csv(path, sep=r"\s+", header=None, names=COLUMNS)


def load_train() -> pd.DataFrame:
    """Training engines, each run to failure, with true and capped RUL per cycle."""
    df = _read("train_FD001.txt")
    last_cycle = df.groupby("unit")["cycle"].transform("max")
    df["rul"] = last_cycle - df["cycle"]
    df["rul_capped"] = df["rul"].clip(upper=RUL_CAP)
    return df


def load_test() -> pd.DataFrame:
    """Test engines truncated before failure, with the official RUL attached to every cycle."""
    df = _read("test_FD001.txt")
    final_rul = pd.read_csv(DATA_DIR / "RUL_FD001.txt", header=None, names=["final_rul"])
    final_rul["unit"] = range(1, len(final_rul) + 1)

    df = df.merge(final_rul, on="unit", how="left")
    last_cycle = df.groupby("unit")["cycle"].transform("max")
    df["rul"] = df["final_rul"] + (last_cycle - df["cycle"])
    df["rul_capped"] = df["rul"].clip(upper=RUL_CAP)
    return df.drop(columns="final_rul")
