"""간헐수요 모델 — 손으로 계산한 값과 맞춰봅니다.

시리즈  y = [0, 2, 0, 0, 4, 0, 6]   alpha = 0.1

Croston
    첫 수요는 index 1 → z = 2 · p = 2 · q = 1
    t=2 y=0 → q=2
    t=3 y=0 → q=3
    t=4 y=4 → z = 0.1·4 + 0.9·2   = 2.2
              p = 0.1·3 + 0.9·2   = 2.1   q=1
    t=5 y=0 → q=2
    t=6 y=6 → z = 0.1·6 + 0.9·2.2 = 2.58
              p = 0.1·2 + 0.9·2.1 = 2.09  q=1
    예측 = 2.58 / 2.09 = 1.2344497...

SBA
    보정계수 = 1 − 0.1/2 = 0.95
    예측 = 0.95 · 1.2344497 = 1.1727272...

TSB   alpha_demand = 0.2 · alpha_prob = 0.1   (두 상수를 다르게 두어 뒤바뀌면 실패합니다)
    첫 수요는 index 1 → z = 2 · p = 1/2 = 0.5
    t=2 y=0 → p = 0.5   + 0.1·(0−0.5)   = 0.45
    t=3 y=0 → p = 0.45  + 0.1·(0−0.45)  = 0.405
    t=4 y=4 → z = 2     + 0.2·(4−2)     = 2.4
              p = 0.405 + 0.1·(1−0.405) = 0.4645
    t=5 y=0 → p = 0.4645+ 0.1·(0−0.4645)= 0.41805
    t=6 y=6 → z = 2.4   + 0.2·(6−2.4)   = 3.12
              p = 0.41805 + 0.1·(1−0.41805) = 0.476245
    예측 = 3.12 · 0.476245 = 1.4858844
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.models.croston import croston, sba, tsb

ALPHA = 0.1
SERIES = [0.0, 2.0, 0.0, 0.0, 4.0, 0.0, 6.0]


def frame(values, start="2023-01-01", item_id="ITEM-A") -> pd.DataFrame:
    periods = pd.date_range(start=start, periods=len(values), freq="MS")
    return pd.DataFrame({"item_id": item_id, "period": periods, "quantity": values})


def test_croston_first_forecast_matches_hand_calculation():
    result = croston(frame(SERIES), horizon=3, params={"alpha": ALPHA})
    assert len(result) == 3
    assert result["predicted_qty"].iloc[0] == pytest.approx(2.58 / 2.09, rel=1e-9)
    # Croston 예측은 전 구간 평평합니다.
    assert result["predicted_qty"].nunique() == 1
    assert result.attrs["explanation"]["demand_size"] == pytest.approx(2.58, rel=1e-9)
    assert result.attrs["explanation"]["demand_interval"] == pytest.approx(2.09, rel=1e-9)


def test_sba_applies_bias_correction():
    base = croston(frame(SERIES), horizon=3, params={"alpha": ALPHA})
    result = sba(frame(SERIES), horizon=3, params={"alpha": ALPHA})
    expected = (1 - ALPHA / 2) * base["predicted_qty"].iloc[0]
    assert result["predicted_qty"].iloc[0] == pytest.approx(expected, rel=1e-9)
    assert result.attrs["explanation"]["bias_correction"] == pytest.approx(0.95)


def test_tsb_first_forecast_matches_hand_calculation():
    """docstring 에서 손으로 유도한 리터럴과 맞춰봅니다.

    두 평활 상수를 다르게 두었으므로 구현이 alpha_demand 와 alpha_prob 를 뒤바꾸면
    이 테스트가 실패합니다.
    """
    result = tsb(frame(SERIES), horizon=3, params={"alpha_demand": 0.2, "alpha_prob": 0.1})

    assert len(result) == 3
    assert result["predicted_qty"].iloc[0] == pytest.approx(1.4858844, rel=1e-9)
    assert result["predicted_qty"].nunique() == 1
    assert result.attrs["explanation"]["demand_size"] == pytest.approx(3.12, rel=1e-9)
    # explanation 은 소수 4자리로 반올림해 담습니다
    assert result.attrs["explanation"]["demand_probability"] == pytest.approx(0.4762)


def test_tsb_smoothing_constants_are_not_interchangeable():
    """상수를 맞바꾸면 다른 숫자가 나와야 합니다."""
    swapped = tsb(frame(SERIES), horizon=1, params={"alpha_demand": 0.1, "alpha_prob": 0.2})
    assert swapped["predicted_qty"].iloc[0] != pytest.approx(1.4858844, rel=1e-6)


def test_tsb_in_sample_fit_starts_after_the_first_demand():
    """전체 표본으로 초기화하면 fit 에 미래가 새어 들어갑니다. 첫 수요 전은 nan 이어야 합니다."""
    result = tsb(frame(SERIES), horizon=1, params={"alpha_demand": 0.2, "alpha_prob": 0.1})
    fit = result.attrs["fit"]
    assert len(fit) == len(SERIES)
    assert np.isnan(fit[0]) and np.isnan(fit[1])      # 첫 수요(index 1)까지는 잴 수 없습니다
    assert np.isfinite(fit[2:]).all()


def test_intermittent_models_return_empty_when_almost_no_demand():
    lonely = [0.0] * 11 + [5.0]
    for fn in (croston, sba, tsb):
        result = fn(frame(lonely), horizon=6, params={"alpha": ALPHA})
        assert len(result) == 0
        assert "reason" in result.attrs


def test_intermittent_models_never_emit_negative_or_nan():
    result = croston(frame(SERIES), horizon=12, params={"alpha": ALPHA})
    assert len(result) == 12
    assert (result["predicted_qty"] >= 0).all()
    assert np.isfinite(result["predicted_qty"]).all()


def test_forecast_periods_follow_training_period():
    result = croston(frame(SERIES), horizon=2, params={"alpha": ALPHA})
    # 학습 마지막 달은 2023-07. 예측은 2023-08 부터입니다.
    assert list(result["period"]) == [pd.Timestamp("2023-08-01"), pd.Timestamp("2023-09-01")]
