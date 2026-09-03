"""HOLT_WINTERS — 가법 추세 + 가법 계절 (statsmodels ExponentialSmoothing).

renew.prd 11.1 · 11.4 — 계절 주기와 감쇠 여부를 파라미터로 조정합니다.

계절 성분을 추정하려면 최소 **2주기** 가 필요합니다. 학습 기간이 2주기(기본 24개월)
미만이면 값을 만들지 않고 빈 결과를 돌려줍니다. 짧은 데이터에 억지로 계절을 씌우면
숫자는 나오지만 근거가 없습니다 (renew.prd 31.5).

parameters
    seasonal_periods  계절 주기. 기본 12
    damped            추세 감쇠 여부. 기본 true
"""

from __future__ import annotations

import warnings

import numpy as np

from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "HOLT_WINTERS"

DEFAULT_SEASONAL_PERIODS = 12


def forecast(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    seasonal_periods = int(params.get("seasonal_periods") or DEFAULT_SEASONAL_PERIODS)
    damped = bool(params.get("damped", True))

    y = quantities(train_df)
    required = 2 * seasonal_periods

    if len(y) < required:
        return empty_result(
            f"계절 주기 {seasonal_periods}개월 × 2 = {required}개월이 필요한데 {len(y)}개월뿐입니다"
        )
    if not np.any(y > 0):
        return empty_result("학습 구간 수요가 모두 0 입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = ExponentialSmoothing(
                y,
                trend="add",
                damped_trend=damped,
                seasonal="add",
                seasonal_periods=seasonal_periods,
                initialization_method="estimated",
            ).fit(optimized=True)
            point = np.asarray(res.forecast(horizon), dtype=float)
            fit = np.asarray(res.fittedvalues, dtype=float)
    except ImportError:
        return empty_result("statsmodels 가 설치되어 있지 않습니다")
    except Exception as exc:
        return empty_result(f"적합에 실패했습니다: {exc}")

    point = np.clip(point, 0.0, None)

    return make_result(
        periods,
        point,
        fit=fit,
        explanation={
            "method": "holt_winters_additive",
            "seasonal_periods": seasonal_periods,
            "damped": damped,
            "n_train": int(len(y)),
        },
    )
