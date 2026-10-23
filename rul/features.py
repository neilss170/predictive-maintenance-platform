"""Causal per-engine features: every value uses only the cycles seen so far."""

from __future__ import annotations

import pandas as pd

from rul.data import SENSORS


ROLLING_WINDOW = 10
SLOPE_WINDOW = 20
BASELINE_CYCLES = 10


def feature_names() -> list[str]:
    names = ["cycle"]
    for sensor in SENSORS:
        names += [
            sensor,
            f"{sensor}_mean{ROLLING_WINDOW}",
            f"{sensor}_std{ROLLING_WINDOW}",
            f"{sensor}_slope{SLOPE_WINDOW}",
            f"{sensor}_drift",
        ]
    return names


def build_features(history: pd.DataFrame) -> pd.DataFrame:
    """Add rolling, trend and drift features to cycle-level sensor history.

    `history` needs `unit`, `cycle` and the informative sensor columns. Rows are
    sorted by unit and cycle; the returned frame keeps any extra columns.
    """
    missing = [column for column in ["unit", "cycle", *SENSORS] if column not in history]
    if missing:
        raise ValueError(f"history is missing columns: {missing}")

    df = history.sort_values(["unit", "cycle"]).reset_index(drop=True)
    groups = df.groupby("unit", sort=False)
    t = df["cycle"].astype(float)
    new_columns = {}

    def rolling_mean(series: pd.Series, window: int) -> pd.Series:
        return series.groupby(df["unit"]).transform(
            lambda x: x.rolling(window, min_periods=1).mean()
        )

    t_mean = rolling_mean(t, SLOPE_WINDOW)
    t_var = rolling_mean(t * t, SLOPE_WINDOW) - t_mean**2

    for sensor in SENSORS:
        x = df[sensor].astype(float)
        new_columns[f"{sensor}_mean{ROLLING_WINDOW}"] = rolling_mean(x, ROLLING_WINDOW)
        new_columns[f"{sensor}_std{ROLLING_WINDOW}"] = groups[sensor].transform(
            lambda s: s.rolling(ROLLING_WINDOW, min_periods=2).std()
        ).fillna(0.0)

        # Least-squares slope over the trailing window, from rolling moments.
        covariance = rolling_mean(t * x, SLOPE_WINDOW) - t_mean * rolling_mean(x, SLOPE_WINDOW)
        new_columns[f"{sensor}_slope{SLOPE_WINDOW}"] = (
            (covariance / t_var.where(t_var > 0)).fillna(0.0)
        )

        # Drift from the engine's own early-life level absorbs unit-to-unit offsets.
        baseline = groups[sensor].transform(
            lambda s: s.head(BASELINE_CYCLES).expanding().mean().reindex(s.index).ffill()
        )
        new_columns[f"{sensor}_drift"] = x - baseline

    return pd.concat([df, pd.DataFrame(new_columns)], axis=1)
