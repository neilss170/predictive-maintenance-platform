# Predictive Maintenance and Machine Failure Classification

A detailed, leakage-safe machine-failure classification project built from the
UCI AI4I 2020 synthetic predictive-maintenance dataset.

## Final governed result

The selected random-forest pipeline achieved the following on the one-time
governed holdout:

- PR-AUC: **0.957**
- ROC-AUC: **0.984**
- Precision: **0.957**
- Recall: **0.882**
- F1: **0.918**
- Balanced accuracy: **0.940**

The decision threshold is **0.19727**. It was selected on validation data before
the final test evaluation. These results describe a synthetic benchmark and are
not evidence of production performance.

## Authoritative notebook workflow

Run the notebooks in order:

1. `notebook/01_data_cleaning.ipynb` - business framing, prediction point,
   source limitations, raw-data audit, data dictionary, quality checks,
   class balance, leakage analysis, cleaning, and governed split design.
2. `notebook/02_eda.ipynb` - training-only univariate, bivariate, multivariate,
   operating-envelope, interaction, correlation, outlier, and failure-mode
   analysis.
3. `notebook/03_feature_engineering.ipynb` - leakage-safe feature creation,
   preprocessing, validation-governed feature comparison, feature selection,
   schema checks, and finite-value checks.
4. `notebook/04_modeling.ipynb` - baselines, cross-validation, model comparison,
   validation threshold selection, error and subgroup analysis,
   interpretation, frozen-pipeline creation, and one-time test evaluation.

All four notebooks are executed and retained with their outputs. Superseded
artifacts are kept in a local `archive/` folder for audit purposes and excluded
from version control because they are not part of the current scoring or
deployment path.

## Current project structure

```text
data/raw/ai4i2020.csv
notebook/01_data_cleaning.ipynb
notebook/02_eda.ipynb
notebook/03_feature_engineering.ipynb
notebook/04_modeling.ipynb
models/final_governed_pipeline.joblib
models/governed_model_contract.json
reports/final_governed_test_metrics.json
predict.py
export_model_for_web.py
validate_web_model.py
tests/test_pipeline.py
dashboard/
```

## Leakage policy

- Target: `Machine failure`
- Identifiers excluded: `UDI`, `Product ID`
- Target-derived failure-mode labels excluded: `TWF`, `HDF`, `PWF`, `OSF`,
  `RNF`
- Eligible measured inputs: `Type`, air temperature, process temperature,
  rotational speed, torque, and tool wear
- Eligible deterministic features: temperature difference, mechanical power,
  and the governed torque/tool-wear interaction

The saved model contract is the source of truth for feature order, input
constraints, threshold, and model metadata.

## Reproduce the analysis

Use the registered **Python (Predictive Maintenance)** kernel:

```powershell
$notebooks = @(
  "notebook/01_data_cleaning.ipynb",
  "notebook/02_eda.ipynb",
  "notebook/03_feature_engineering.ipynb",
  "notebook/04_modeling.ipynb"
)

foreach ($notebook in $notebooks) {
  .\.venv\Scripts\python.exe -m jupyter nbconvert --execute --to notebook `
    --inplace $notebook `
    --ExecutePreprocessor.kernel_name=predictive-maintenance `
    --ExecutePreprocessor.timeout=1200
}
```

Run the pipeline tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Score one observation

```powershell
.\.venv\Scripts\python.exe predict.py `
  --type L `
  --air-temperature 298.1 `
  --process-temperature 308.6 `
  --rotational-speed 1551 `
  --torque 42.8 `
  --tool-wear 0
```

The CLI validates the input, computes governed deterministic features, applies
the frozen pipeline, and classifies the probability using the saved threshold.

## Interactive dashboard

Live demo:
https://predictive-maintenance-ai4i.k-s-m.chatgpt.site

The deployed React dashboard supports both single-machine and fleet assessment:

- synchronized operating controls and explicit model scoring;
- governed failure probability, risk band, and review recommendation;
- pinned what-if comparisons and local assessment history;
- upload and validation of fleet CSV files with up to 5,000 rows;
- target/leakage-column rejection and row-level validation errors;
- fleet risk summaries, distribution, search, filters, sorting, and pagination;
- maintenance-priority ranking and scored/error CSV exports;
- one-click handoff from a fleet row to the single-machine view.

The deterministic 600-row synthetic fleet fixture is
`dashboard/public/sample-fleet.csv`. Expected model results are retained in
`dashboard/public/sample-fleet-scored.csv` for audit and regression checking.
Machine IDs are display-only identifiers and never enter the model.

## Rebuild the dashboard model

```powershell
.\.venv\Scripts\python.exe export_model_for_web.py
.\.venv\Scripts\python.exe validate_web_model.py
Set-Location dashboard
npm.cmd run build
npm.cmd test
npm.cmd run test:sites
```

The parity validator checks the exported browser model against the Python
pipeline. The maximum absolute probability error in the current build is below
`2e-16`.

## Deployment boundary

Before operational use, validate the complete workflow on representative,
time-stamped equipment data with equipment-aware splits. Define the actual cost
of missed failures and false alarms, assess calibration and drift, establish
monitoring and retraining rules, and obtain maintenance-owner approval for the
operating threshold.
