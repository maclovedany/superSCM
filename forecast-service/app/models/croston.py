"""CROSTON · SBA · TSB — 간헐수요 전용. 직접 구현합니다.

renew.prd 10 · 11.1
    "간헐수요 모델은 반드시 포함한다. 자재는 몇 달에 한 번 나가는 품목이 많고,
     일반 시계열 모델은 이런 패턴에서 무너진다."

세 모델이 한 파일에 있고 각각 MODEL_ID 로 등록됩니다 (아래 MODELS dict).

──────────────────────────────────────────────────────────────
Croston (1972)
    수요를 **크기(z)** 와 **발생 간격(p)** 두 시계열로 나눠 각각 지수평활합니다.

    초기값   첫 수요가 index i0 에 있으면  z = y[i0] · p = i0 + 1 · q = 1
    갱신     y[t] = 0        →  q += 1
             y[t] > 0        →  z = α·y[t] + (1−α)·z
                                p = α·q    + (1−α)·p
                                q = 1
    예측     z / p  (전 구간 평평)

SBA (Syntetos–Boylan Approximation)
    Croston 은 구조적으로 과대예측합니다. 편향 보정 계수를 곱합니다.
    예측 = (1 − α/2) · z / p

TSB (Teunter–Syntetos–Babai)
    크기(z) 와 **수요 발생 확률(p)** 을 평활합니다. 확률은 수요가 없는 달에도
    갱신되므로 "이제 안 나가는 품목" 을 Croston 보다 빨리 반영합니다.

    초기값   z = 수요가 있었던 달의 평균 · p = 수요가 있었던 달 수 / 전체 달 수
    갱신     y[t] > 0 → z += α_d·(y[t] − z) ·  p += α_p·(1 − p)
             y[t] = 0 →                        p += α_p·(0 − p)
    예측     p · z
──────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import numpy as np

from . import empty_result, future_periods, make_result, quantities

DEFAULT_ALPHA = 0.1

# 이보다 수요 발생 횟수가 적으면 크기·간격을 평활할 근거가 없습니다.
MIN_DEMAND_EVENTS = 2


def _alpha(params: dict, key: str = "alpha") -> float:
    value = (params or {}).get(key)
    try:
        alpha = float(value)
    except (TypeError, ValueError):
        return DEFAULT_ALPHA
    if not 0.0 < alpha <= 1.0:
        return DEFAULT_ALPHA
    return alpha


def _croston_state(y: np.ndarray, alpha: float):
    """Croston 상태(z, p)와 in-sample 한 걸음 앞 적합값을 함께 돌려줍니다."""
    nonzero = np.flatnonzero(y > 0)
    if len(nonzero) == 0:
        return None, None, None

    i0 = int(nonzero[0])
    z = float(y[i0])
    p = float(i0 + 1)
    q = 1.0

    fit = np.full(len(y), np.nan, dtype=float)
    for t in range(i0 + 1, len(y)):
        # 적합값은 t 를 보기 **전** 상태로 계산합니다 (한 걸음 앞 예측).
        fit[t] = z / p if p > 0 else np.nan
        if y[t] > 0:
            z = alpha * float(y[t]) + (1.0 - alpha) * z
            p = alpha * q + (1.0 - alpha) * p
            q = 1.0
        else:
            q += 1.0

    return z, p, fit


def croston(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    alpha = _alpha(params)
    y = quantities(train_df)

    if int(np.count_nonzero(y > 0)) < MIN_DEMAND_EVENTS:
        return empty_result(f"수요가 발생한 기간이 {MIN_DEMAND_EVENTS}회 미만입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    z, p, fit = _croston_state(y, alpha)
    if z is None or not p or not np.isfinite(z / p):
        return empty_result("크기·간격을 평활할 수 없습니다")

    point = z / p
    return make_result(
        periods,
        np.full(horizon, point, dtype=float),
        fit=fit,
        explanation={
            "method": "croston",
            "alpha": alpha,
            "demand_size": round(z, 4),
            "demand_interval": round(p, 4),
            "n_events": int(np.count_nonzero(y > 0)),
        },
    )


def sba(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    alpha = _alpha(params)
    y = quantities(train_df)

    if int(np.count_nonzero(y > 0)) < MIN_DEMAND_EVENTS:
        return empty_result(f"수요가 발생한 기간이 {MIN_DEMAND_EVENTS}회 미만입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    z, p, fit = _croston_state(y, alpha)
    if z is None or not p or not np.isfinite(z / p):
        return empty_result("크기·간격을 평활할 수 없습니다")

    correction = 1.0 - alpha / 2.0
    point = correction * z / p
    return make_result(
        periods,
        np.full(horizon, point, dtype=float),
        fit=None if fit is None else correction * fit,
        explanation={
            "method": "croston_sba",
            "alpha": alpha,
            "bias_correction": round(correction, 4),
            "demand_size": round(z, 4),
            "demand_interval": round(p, 4),
            "n_events": int(np.count_nonzero(y > 0)),
        },
    )


def tsb(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    alpha_demand = _alpha(params, "alpha_demand")
    alpha_prob = _alpha(params, "alpha_prob")
    y = quantities(train_df)

    n = len(y)
    events = int(np.count_nonzero(y > 0))
    if events < MIN_DEMAND_EVENTS:
        return empty_result(f"수요가 발생한 기간이 {MIN_DEMAND_EVENTS}회 미만입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    # 첫 수요만 보고 시작합니다. 전체 표본 통계를 쓰면 fit[0] 에 미래가 들어갑니다.
    i0 = int(np.flatnonzero(y > 0)[0])
    z = float(y[i0])
    p = 1.0 / (i0 + 1)

    fit = np.full(n, np.nan, dtype=float)
    for t in range(i0 + 1, n):
        # 적합값은 t 를 보기 **전** 상태로 계산합니다 (한 걸음 앞 예측).
        fit[t] = p * z
        if y[t] > 0:
            z += alpha_demand * (float(y[t]) - z)
            p += alpha_prob * (1.0 - p)
        else:
            p += alpha_prob * (0.0 - p)

    point = p * z
    if not np.isfinite(point):
        return empty_result("크기·확률을 평활할 수 없습니다")

    return make_result(
        periods,
        np.full(horizon, point, dtype=float),
        fit=fit,
        explanation={
            "method": "tsb",
            "alpha_demand": alpha_demand,
            "alpha_prob": alpha_prob,
            "demand_size": round(z, 4),
            "demand_probability": round(p, 4),
            "n_events": events,
        },
    )


# 파일 하나에 모델 셋. registry 는 이 dict 를 그대로 읽습니다.
MODELS = {
    "CROSTON": croston,
    "SBA": sba,
    "TSB": tsb,
}
