"""예측구간 — sql/11-forecast-engine.sql 과 같은 방식.

in-sample 잔차의 표본표준편차 σ 를 구하고 정규 근사로 상위 분위수를 만듭니다.

    p50 = 점추정
    p80 = 점추정 + 0.8416 σ
    p90 = 점추정 + 1.2816 σ

σ 를 구할 수 없으면 **null** 로 둡니다. 임의 값으로 채우지 않습니다
(AGENTS.md 규칙 5 · renew.prd 31.5).
"""

from __future__ import annotations

import numpy as np

# 표준정규 분위수. sql/11 이 쓰는 상수와 같습니다.
Z_P80 = 0.8416
Z_P90 = 1.2816

# 잔차가 이보다 적으면 표본표준편차를 신뢰하지 않습니다.
MIN_RESIDUALS = 2


def residual_sigma(actual, fit) -> float | None:
    """잔차 표준편차. SQL 의 stddev_samp 와 같게 ddof=1 을 씁니다."""
    if fit is None or actual is None:
        return None
    a = np.asarray(actual, dtype=float).reshape(-1)
    f = np.asarray(fit, dtype=float).reshape(-1)
    n = min(len(a), len(f))
    if n == 0:
        return None
    a, f = a[-n:], f[-n:]
    mask = np.isfinite(a) & np.isfinite(f)
    if int(mask.sum()) < MIN_RESIDUALS:
        return None
    resid = a[mask] - f[mask]
    sigma = float(np.std(resid, ddof=1))
    if not np.isfinite(sigma):
        return None
    return sigma


def quantiles(point: float, sigma: float | None) -> tuple[float | None, float | None, float | None]:
    """(p50, p80, p90). σ 가 없으면 p80·p90 은 None 입니다."""
    if point is None or not np.isfinite(point):
        return None, None, None
    p50 = float(point)
    if sigma is None or not np.isfinite(sigma):
        return p50, None, None
    return p50, max(0.0, p50 + Z_P80 * sigma), max(0.0, p50 + Z_P90 * sigma)
