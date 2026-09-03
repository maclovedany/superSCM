"""ETS — 단순 지수평활 (statsmodels SimpleExpSmoothing).

renew.prd 11.1 시계열 계열. 추세·계절을 가정하지 않고 최근값에 지수 가중을 줍니다.
예측은 평평합니다 (Baseline 이동평균과 같은 모양이지만 가중이 지수적입니다).

parameters
    alpha  평활 상수. null 이면 statsmodels 가 SSE 최소화로 추정합니다.
"""

from __future__ import annotations

import warnings

import numpy as np

from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "ETS"

# 지수평활은 최소한 이만큼은 있어야 의미가 있습니다.
MIN_PERIODS = 3


def forecast(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    y = quantities(train_df)

    if len(y) < MIN_PERIODS:
        return empty_result(f"학습 기간이 {MIN_PERIODS}개 미만입니다")
    if not np.any(y > 0):
        return empty_result("학습 구간 수요가 모두 0 입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    alpha = params.get("alpha")

    try:
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = SimpleExpSmoothing(y, initialization_method="estimated")
            if alpha is None:
                res = model.fit(optimized=True)
            else:
                res = model.fit(smoothing_level=float(alpha), optimized=False)
            point = np.asarray(res.forecast(horizon), dtype=float)
            fit = np.asarray(res.fittedvalues, dtype=float)
    except ImportError:
        return empty_result("statsmodels 가 설치되어 있지 않습니다")
    except Exception as exc:  # 한 품목의 수렴 실패가 전체를 멈추지 않습니다
        return empty_result(f"적합에 실패했습니다: {exc}")

    # 수요는 음수가 될 수 없습니다.
    point = np.clip(point, 0.0, None)

    return make_result(
        periods,
        point,
        fit=fit,
        explanation={
            "method": "simple_exponential_smoothing",
            "alpha": round(float(res.params.get("smoothing_level", float("nan"))), 4)
            if np.isfinite(res.params.get("smoothing_level", float("nan")))
            else None,
            "n_train": int(len(y)),
        },
    )
