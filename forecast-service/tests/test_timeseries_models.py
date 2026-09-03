"""시계열 모델 — 합성 계절 시리즈로 검사합니다.

DB 없이 돕니다. 값의 정확도가 아니라 **계약** 을 봅니다.
    · horizon 개 행이 나오는가
    · 값이 유한하고 음수가 아닌가
    · 데이터가 모자라면 빈 결과를 내는가 (0 으로 채우지 않는가)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.models.ets import forecast as ets_forecast
from app.models.holt_winters import forecast as hw_forecast
from app.models.sarima import forecast as sarima_forecast

HORIZON = 12


def seasonal_series(months: int, seed: int = 7) -> pd.DataFrame:
    """추세 + 12개월 계절 + 잡음."""
    rng = np.random.default_rng(seed)
    t = np.arange(months)
    values = 100 + 2.0 * t + 20 * np.sin(2 * np.pi * t / 12) + rng.normal(0, 3, months)
    periods = pd.date_range(start="2022-01-01", periods=months, freq="MS")
    return pd.DataFrame({"item_id": "ITEM-S", "period": periods, "quantity": np.clip(values, 0, None)})


def assert_valid(result, horizon: int = HORIZON):
    assert len(result) == horizon
    values = result["predicted_qty"].to_numpy(dtype=float)
    assert np.isfinite(values).all()
    assert (values >= 0).all()
    assert list(result.columns) == ["period", "predicted_qty"]
    assert result["period"].is_monotonic_increasing


def test_ets_produces_horizon_rows():
    result = ets_forecast(seasonal_series(36), HORIZON, {"alpha": None})
    assert_valid(result)
    assert "fit" in result.attrs


def test_ets_with_fixed_alpha():
    result = ets_forecast(seasonal_series(36), HORIZON, {"alpha": 0.3})
    assert_valid(result)


def test_ets_empty_when_series_too_short():
    result = ets_forecast(seasonal_series(2), HORIZON, {})
    assert len(result) == 0
    assert "reason" in result.attrs


def test_holt_winters_produces_horizon_rows_with_three_years():
    result = hw_forecast(seasonal_series(36), HORIZON, {"seasonal_periods": 12, "damped": True})
    assert_valid(result)
    assert result.attrs["explanation"]["seasonal_periods"] == 12


def test_holt_winters_is_empty_below_two_seasons():
    """12개월뿐이면 계절 성분을 추정할 근거가 없습니다. 빈 결과를 냅니다."""
    result = hw_forecast(seasonal_series(12), HORIZON, {"seasonal_periods": 12})
    assert len(result) == 0
    assert "reason" in result.attrs
    assert "24" in result.attrs["reason"]


def test_sarima_produces_horizon_rows():
    result = sarima_forecast(
        seasonal_series(36), HORIZON, {"order": [1, 1, 1], "seasonal_order": [0, 1, 1, 12], "auto": True}
    )
    assert_valid(result)
    assert result.attrs["explanation"]["order"] == [1, 1, 1]


def test_sarima_falls_back_to_non_seasonal_when_short():
    result = sarima_forecast(
        seasonal_series(18), HORIZON, {"order": [1, 1, 1], "seasonal_order": [0, 1, 1, 12], "auto": True}
    )
    assert_valid(result)
    assert result.attrs["explanation"]["seasonal_order"] == [0, 0, 0, 0]


def test_all_zero_series_returns_empty():
    zeros = pd.DataFrame(
        {
            "item_id": "ITEM-Z",
            "period": pd.date_range("2022-01-01", periods=36, freq="MS"),
            "quantity": np.zeros(36),
        }
    )
    for fn in (ets_forecast, hw_forecast, sarima_forecast):
        result = fn(zeros, HORIZON, {})
        assert len(result) == 0, fn
        assert "reason" in result.attrs


def lightgbm_module():
    """lightgbm 은 선택 의존성입니다. 없거나 (macOS libomp 처럼) 로드에 실패하면 건너뜁니다."""
    import importlib

    try:
        return importlib.import_module("app.models.lightgbm_model")
    except Exception as exc:   # ImportError · OSError(libomp) 등
        pytest.skip(f"lightgbm 을 쓸 수 없습니다: {exc}")


def test_lightgbm_when_installed():
    lightgbm_model = lightgbm_module()
    result = lightgbm_model.forecast(seasonal_series(48), HORIZON, {"lags": [1, 2, 3, 6, 12], "n_estimators": 50})
    assert_valid(result)
    assert result.attrs["explanation"]["method"] == "lightgbm"


def test_lightgbm_empty_when_too_short():
    lightgbm_model = lightgbm_module()
    result = lightgbm_model.forecast(seasonal_series(15), HORIZON, {})
    assert len(result) == 0
    assert "reason" in result.attrs


def test_lightgbm_sigma_is_measured_out_of_fold():
    """학습에 쓴 행을 그대로 예측하면 σ 가 0 으로 붕괴합니다.

    트리 200개는 수십 행짜리 학습셋을 거의 외웁니다. 그 σ 를 STEP 10 안전재고가 읽으면
    재고가 실제 위험보다 얇게 잡힙니다. out-of-fold 잔차로 재야 정직한 값이 나옵니다.
    """
    from app.intervals import residual_sigma

    lightgbm_model = lightgbm_module()
    series = seasonal_series(48)
    quantity = series["quantity"].to_numpy(dtype=float)

    result = lightgbm_model.forecast(series, HORIZON, {})
    oof_fit = result.attrs["fit"]
    oof_sigma = residual_sigma(quantity, oof_fit)

    # 같은 모델을 학습셋 그대로 예측했을 때의 σ (비교용)
    lags, max_lag = [1, 2, 3, 6, 12], 12
    months = pd.to_datetime(series["period"]).dt.month.to_numpy()
    x = np.asarray(
        [[quantity[i - lag] for lag in lags] + [float(months[i])] for i in range(max_lag, len(quantity))]
    )
    y = np.asarray([quantity[i] for i in range(max_lag, len(quantity))])
    memoriser = lightgbm_model._regressor(200)
    memoriser.fit(x, y)
    in_sample_fit = np.full(len(quantity), np.nan)
    in_sample_fit[max_lag:] = memoriser.predict(x)
    in_sample_sigma = residual_sigma(quantity, in_sample_fit)

    assert oof_sigma is not None and oof_sigma > 0
    assert oof_sigma > 5 * in_sample_sigma
    assert result.attrs["explanation"]["sigma_basis"] == "out_of_fold"


def test_lightgbm_fit_leaves_unmeasurable_positions_null():
    """시차 구간과 첫 fold 의 학습 구간은 잴 수 없습니다. 0 으로 채우지 않습니다."""
    lightgbm_model = lightgbm_module()
    result = lightgbm_model.forecast(seasonal_series(48), HORIZON, {})
    fit = result.attrs["fit"]
    assert np.isnan(fit[:12]).all()      # 시차 12개월치는 feature 를 만들 수 없습니다
    assert np.isfinite(fit).any()
