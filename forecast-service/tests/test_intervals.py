"""예측구간 — sql/11 과 같은 상수·같은 표준편차(ddof=1)를 쓰는지."""

from __future__ import annotations

import numpy as np
import pytest

from app.intervals import Z_P80, Z_P90, quantiles, residual_sigma


def test_sigma_matches_sample_standard_deviation():
    actual = np.asarray([10.0, 12.0, 9.0, 11.0])
    fit = np.asarray([9.0, 11.0, 10.0, 10.0])
    expected = float(np.std(actual - fit, ddof=1))   # SQL stddev_samp 와 같습니다
    assert residual_sigma(actual, fit) == pytest.approx(expected)


def test_sigma_ignores_nan_positions():
    actual = np.asarray([10.0, 12.0, 9.0, 11.0])
    fit = np.asarray([np.nan, 11.0, 10.0, 10.0])
    expected = float(np.std(np.asarray([1.0, -1.0, 1.0]), ddof=1))
    assert residual_sigma(actual, fit) == pytest.approx(expected)


def test_sigma_is_none_without_enough_residuals():
    assert residual_sigma(np.asarray([1.0]), np.asarray([1.0])) is None
    assert residual_sigma(np.asarray([1.0, 2.0]), None) is None
    assert residual_sigma(np.asarray([1.0, 2.0]), np.asarray([np.nan, np.nan])) is None


def test_quantiles_use_the_same_z_values_as_sql():
    p50, p80, p90 = quantiles(100.0, 10.0)
    assert p50 == pytest.approx(100.0)
    assert p80 == pytest.approx(100.0 + Z_P80 * 10.0)
    assert p90 == pytest.approx(100.0 + Z_P90 * 10.0)


def test_quantiles_are_none_without_sigma():
    """σ 를 못 구하면 임의 값으로 채우지 않습니다 (renew.prd 31.5)."""
    p50, p80, p90 = quantiles(100.0, None)
    assert p50 == pytest.approx(100.0)
    assert p80 is None and p90 is None


def test_quantiles_never_go_below_zero():
    _, p80, p90 = quantiles(0.0, 5.0)
    assert p80 >= 0 and p90 >= 0
