"""SARIMA — statsmodels SARIMAX.

renew.prd 11.4 — "차수는 파라미터로 조정하되 자동 추정 옵션을 포함한다."

parameters
    order           (p,d,q). 기본 (1,1,1)
    seasonal_order  (P,D,Q,s). 기본 (0,1,1,12)
    auto            true 면 지정한 차수로 적합에 실패했을 때 더 단순한 차수로 물러섭니다

학습 기간이 2주기(기본 24개월) 미만이면 계절 성분을 뺀 비계절 ARIMA(1,1,1) 로 적합합니다.
"""

from __future__ import annotations

import warnings

import numpy as np

from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "SARIMA"

DEFAULT_ORDER = (1, 1, 1)
DEFAULT_SEASONAL_ORDER = (0, 1, 1, 12)

# auto=true 일 때 순서대로 물러설 후보. 마지막은 random walk 입니다.
FALLBACK_ORDERS = [(1, 1, 1), (0, 1, 1), (1, 0, 0), (0, 1, 0)]

MIN_PERIODS = 6


def _tuple(value, default: tuple) -> tuple:
    if value is None:
        return default
    try:
        parsed = tuple(int(v) for v in value)
    except (TypeError, ValueError):
        return default
    return parsed if len(parsed) == len(default) else default


def _fit(y, order, seasonal_order):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return SARIMAX(
            y,
            order=order,
            seasonal_order=seasonal_order,
            enforce_stationarity=False,
            enforce_invertibility=False,
        ).fit(disp=False)


def forecast(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    order = _tuple(params.get("order"), DEFAULT_ORDER)
    seasonal_order = _tuple(params.get("seasonal_order"), DEFAULT_SEASONAL_ORDER)
    auto = bool(params.get("auto", True))

    y = quantities(train_df)
    if len(y) < MIN_PERIODS:
        return empty_result(f"학습 기간이 {MIN_PERIODS}개 미만입니다")
    if not np.any(y > 0):
        return empty_result("학습 구간 수요가 모두 0 입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    season_length = seasonal_order[3] if seasonal_order[3] else 0
    seasonal_used = seasonal_order
    if season_length and len(y) < 2 * season_length:
        # 계절 성분을 추정할 만큼 길지 않습니다. 비계절 ARIMA 로 내려갑니다.
        seasonal_used = (0, 0, 0, 0)

    attempts = [(order, seasonal_used)]
    if auto:
        for fallback in FALLBACK_ORDERS:
            candidate = (fallback, (0, 0, 0, 0))
            if candidate not in attempts:
                attempts.append(candidate)

    last_error = None
    for attempt_order, attempt_seasonal in attempts:
        try:
            res = _fit(y, attempt_order, attempt_seasonal)
            point = np.asarray(res.forecast(horizon), dtype=float)
            if not np.all(np.isfinite(point)):
                last_error = "예측값이 유한하지 않습니다"
                continue
            fit = np.asarray(res.fittedvalues, dtype=float).copy()
            # 차분 구간의 적합값은 의미가 없습니다. 잔차 σ 에서 빼기 위해 nan 으로 둡니다.
            burn = attempt_order[1] + attempt_seasonal[1] * (attempt_seasonal[3] or 0)
            if burn:
                fit[: min(burn, len(fit))] = np.nan
            point = np.clip(point, 0.0, None)
            return make_result(
                periods,
                point,
                fit=fit,
                explanation={
                    "method": "sarimax",
                    "order": list(attempt_order),
                    "seasonal_order": list(attempt_seasonal),
                    "auto": auto,
                    "n_train": int(len(y)),
                },
            )
        except ImportError:
            return empty_result("statsmodels 가 설치되어 있지 않습니다")
        except Exception as exc:
            last_error = str(exc)
            continue

    return empty_result(f"적합에 실패했습니다: {last_error}")
