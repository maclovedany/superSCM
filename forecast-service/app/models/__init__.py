"""모델 플러그인 공통 도구.

renew.prd 11.2 — 모든 모델은 함수 하나만 구현합니다.

    def forecast(train_df: pd.DataFrame, horizon: int, params: dict) -> pd.DataFrame:
        # 입력  item_id · period(월초 date) · quantity   (한 품목의 학습 구간 격자. 0 인 달 포함)
        # 출력  period · predicted_qty
        #       df.attrs['fit']         선택. in-sample 적합값 (σ 계산용)
        #       df.attrs['explanation'] 선택. 근거 dict
        #       df.attrs['reason']      값을 못 낸 사유 (빈 결과일 때)

값을 낼 수 없으면 ``empty_result(reason)`` 으로 **빈 DataFrame** 을 돌려줍니다.
0 이나 임의 값으로 채우지 않습니다 (AGENTS.md 규칙 5 · renew.prd 31.5).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = [
    "RESULT_COLUMNS",
    "empty_result",
    "future_periods",
    "make_result",
    "quantities",
]

RESULT_COLUMNS = ["period", "predicted_qty"]


def quantities(train_df: pd.DataFrame) -> np.ndarray:
    """학습 구간 수요를 기간 오름차순 float 배열로 돌려줍니다."""
    if train_df is None or len(train_df) == 0:
        return np.asarray([], dtype=float)
    ordered = train_df.sort_values("period")
    return pd.to_numeric(ordered["quantity"], errors="coerce").fillna(0.0).to_numpy(dtype=float)


def _step_is_month(periods: pd.Series) -> bool:
    """기간 간격으로 월/주 단위를 판정합니다 (core.forecast_setting.granularity 를 그대로 따라갑니다)."""
    if len(periods) < 2:
        return True
    diffs = periods.sort_values().diff().dropna()
    if len(diffs) == 0:
        return True
    return float(diffs.dt.days.median()) >= 20.0


def future_periods(train_df: pd.DataFrame, horizon: int) -> list[pd.Timestamp]:
    """예측 구간. 학습 구간 마지막 기간 다음부터 horizon 개 (sql/11 과 같은 기준)."""
    if train_df is None or len(train_df) == 0 or horizon <= 0:
        return []
    periods = pd.to_datetime(pd.Series(train_df["period"]))
    last = periods.max()
    if _step_is_month(periods):
        return [pd.Timestamp(last) + pd.DateOffset(months=h) for h in range(1, horizon + 1)]
    return [pd.Timestamp(last) + pd.Timedelta(days=7 * h) for h in range(1, horizon + 1)]


def make_result(
    periods: list[pd.Timestamp],
    values,
    fit=None,
    explanation: dict | None = None,
) -> pd.DataFrame:
    """예측 결과 DataFrame. 유한하지 않은 값은 행을 만들지 않습니다."""
    arr = np.asarray(values, dtype=float).reshape(-1)
    n = min(len(periods), len(arr))
    rows = [
        {"period": pd.Timestamp(periods[i]), "predicted_qty": float(arr[i])}
        for i in range(n)
        if np.isfinite(arr[i])
    ]
    df = pd.DataFrame(rows, columns=RESULT_COLUMNS)
    if fit is not None:
        df.attrs["fit"] = np.asarray(fit, dtype=float).reshape(-1)
    if explanation:
        df.attrs["explanation"] = dict(explanation)
    return df


def empty_result(reason: str) -> pd.DataFrame:
    """값을 낼 수 없을 때. 사유를 attrs 에 남깁니다."""
    df = pd.DataFrame(columns=RESULT_COLUMNS)
    df.attrs["reason"] = reason
    return df
