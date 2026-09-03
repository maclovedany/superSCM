"""PROPHET — 계절성 · 이벤트 (renew.prd 33.1).

**선택 설치입니다.** `requirements-optional.txt` 로만 들어옵니다.
prophet import 이 실패하면 registry 가 이 모듈을 건너뛰고, `/models` 에도 나오지 않습니다.
core.model_config 에서도 `enabled = false` 로 등록됩니다 (sql/25).

parameters
    seasonality_mode        'additive'(기본) · 'multiplicative'
    yearly_seasonality      기본 auto
    changepoint_prior_scale 기본 0.05
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

# import 실패 시 registry 가 이 모듈을 건너뜁니다 (등록되지 않음).
from prophet import Prophet  # noqa: F401

from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "PROPHET"

# Prophet 은 최소 2주기가 있어야 연 단위 계절을 잡습니다.
MIN_PERIODS = 24


def forecast(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    y = quantities(train_df)

    if len(y) < MIN_PERIODS:
        return empty_result(f"학습 기간이 {MIN_PERIODS}개월 미만입니다")
    if not np.any(y > 0):
        return empty_result("학습 구간 수요가 모두 0 입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    ordered = train_df.sort_values("period")
    history = pd.DataFrame(
        {
            "ds": pd.to_datetime(ordered["period"]).to_numpy(),
            "y": y,
        }
    )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = Prophet(
                seasonality_mode=str(params.get("seasonality_mode") or "additive"),
                yearly_seasonality=params.get("yearly_seasonality", "auto"),
                weekly_seasonality=False,
                daily_seasonality=False,
                changepoint_prior_scale=float(params.get("changepoint_prior_scale") or 0.05),
            )
            model.fit(history)
            future = pd.DataFrame({"ds": [pd.Timestamp(p) for p in periods]})
            point = np.clip(model.predict(future)["yhat"].to_numpy(dtype=float), 0.0, None)
            fit = model.predict(history[["ds"]])["yhat"].to_numpy(dtype=float)
    except Exception as exc:
        return empty_result(f"적합에 실패했습니다: {exc}")

    return make_result(
        periods,
        point,
        fit=fit,
        explanation={
            "method": "prophet",
            "seasonality_mode": str(params.get("seasonality_mode") or "additive"),
            "n_train": int(len(y)),
        },
    )
