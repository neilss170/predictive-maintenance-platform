"""The failure rules the AI4I 2020 dataset was generated from.

From the dataset documentation (Matzka, 2020). Tool wear failure (TWF) and
random failures (RNF) are stochastic, so only the three deterministic modes
make a usable rule-based baseline.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


HDF_TEMP_DIFF_K = 8.6  # heat dissipation: air/process gap below this...
HDF_SPEED_RPM = 1380  # ...and spindle speed below this
PWF_POWER_W = (3500, 9000)  # power failure outside this band
OSF_STRAIN_MIN_NM = {"L": 11000, "M": 12000, "H": 13000}  # overstrain by product quality
TWF_WEAR_MIN = 200  # tool wear failure happens at a random point in 200-240 min


def rule_modes(df: pd.DataFrame) -> pd.DataFrame:
    """Boolean flag per failure rule for raw AI4I readings."""
    temp_diff = df["Process temperature [K]"] - df["Air temperature [K]"]
    speed = df["Rotational speed [rpm]"]
    torque = df["Torque [Nm]"]
    wear = df["Tool wear [min]"]
    power = torque * speed * 2 * np.pi / 60
    strain_limit = df["Type"].map(OSF_STRAIN_MIN_NM)
    return pd.DataFrame({
        "HDF": (temp_diff < HDF_TEMP_DIFF_K) & (speed < HDF_SPEED_RPM),
        "PWF": (power < PWF_POWER_W[0]) | (power > PWF_POWER_W[1]),
        "OSF": torque * wear > strain_limit,
        "TWF": wear >= TWF_WEAR_MIN,
    }, index=df.index)


def rule_baseline(df: pd.DataFrame, include_tool_wear: bool = False) -> np.ndarray:
    """Flag a machine if any deterministic failure rule fires."""
    modes = rule_modes(df)
    columns = ["HDF", "PWF", "OSF"] + (["TWF"] if include_tool_wear else [])
    return modes[columns].any(axis=1).to_numpy()
