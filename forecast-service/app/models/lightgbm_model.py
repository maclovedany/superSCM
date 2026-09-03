"""LIGHTGBM — 시차 feature 회귀.

renew.prd 11.1 · 11.4
    "데이터 길이 때문에 트리 계열이 과적합할 수 있으나 이는 백테스트가 판정할 문제다.
     후보에 넣고 성능이 낮으면 Champion 에 선정되지 않을 뿐이다."

feature   시차 수요 (기본 1·2·3·6·12) + 월 인덱스(1~12)
예측      재귀적 다단계. 예측값을 다시 시차 feature 로 넣습니다.
σ         **out-of-fold 잔차** 로 잽니다. 트리 200개는 수십 행짜리 학습셋을 거의 그대로
          외우므로, in-sample 예측으로 σ 를 재면 0 에 수렴하고 p80·p90 이 점추정에 붙습니다.
          그 sigma 컬럼을 STEP 10 안전재고가 읽으므로 표시만의 문제가 아닙니다.
          시간 순서를 지키는 TimeSeriesSplit 으로 각 fold 의 미학습 구간만 예측합니다.

lightgbm import 이 실패하면 registry 가 이 모델을 **등록하지 않습니다** (파일 상단에서 raise).

parameters
    lags          시차 목록. 기본 [1,2,3,6,12]
    n_estimators  트리 수. 기본 200
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit

# import 실패 시 registry 가 이 모듈을 건너뜁니다 (등록되지 않음).
import lightgbm as lgb  # noqa: F401

from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "LIGHTGBM"

DEFAULT_LAGS = [1, 2, 3, 6, 12]
DEFAULT_N_ESTIMATORS = 200

# 학습 행이 이보다 적으면 트리를 키울 근거가 없습니다.
MIN_TRAIN_ROWS = 8

# out-of-fold 잔차를 만들 최소 학습 행 수와 fold 수
MIN_OOF_ROWS = 6
MAX_SPLITS = 5


def _lags(params: dict) -> list[int]:
    raw = (params or {}).get("lags") or DEFAULT_LAGS
    try:
        lags = sorted({int(v) for v in raw if int(v) > 0})
    except (TypeError, ValueError):
        return list(DEFAULT_LAGS)
    return lags or list(DEFAULT_LAGS)


def _features(history: np.ndarray, index: int, lags: list[int], month: int) -> list[float]:
    """index 시점을 예측하기 위한 feature. history[index-lag] 를 씁니다."""
    row = [float(history[index - lag]) for lag in lags]
    row.append(float(month))
    return row


def _regressor(n_estimators: int):
    """같은 하이퍼파라미터의 새 모델. random_state 고정 (renew.prd 31.3 재현성)."""
    return lgb.LGBMRegressor(
        n_estimators=n_estimators,
        learning_rate=0.05,
        num_leaves=7,
        min_child_samples=3,
        subsample=1.0,
        colsample_bytree=1.0,
        random_state=42,
        verbose=-1,
    )


def _out_of_fold_fit(x_train, y_train, n_periods: int, max_lag: int, n_estimators: int):
    """out-of-fold 한 걸음 앞 적합값. 잴 수 없는 자리는 nan 으로 둡니다."""
    fit = np.full(n_periods, np.nan, dtype=float)
    n_rows = len(y_train)
    if n_rows < MIN_OOF_ROWS:
        return fit

    n_splits = min(MAX_SPLITS, n_rows - 1)
    if n_splits < 2:
        return fit

    for train_idx, test_idx in TimeSeriesSplit(n_splits=n_splits).split(x_train):
        fold = _regressor(n_estimators)
        fold.fit(x_train[train_idx], y_train[train_idx])
        fit[max_lag + test_idx] = fold.predict(x_train[test_idx])
    return fit


def forecast(train_df, horizon: int, params: dict | None = None):
    params = params or {}
    lags = _lags(params)
    n_estimators = int(params.get("n_estimators") or DEFAULT_N_ESTIMATORS)

    y = quantities(train_df)
    max_lag = max(lags)

    if len(y) <= max_lag + MIN_TRAIN_ROWS:
        return empty_result(
            f"시차 {max_lag}개월을 만들고 나면 학습 행이 {MIN_TRAIN_ROWS}개 미만입니다"
        )
    if not np.any(y > 0):
        return empty_result("학습 구간 수요가 모두 0 입니다")

    periods = future_periods(train_df, horizon)
    if not periods:
        return empty_result("예측 기간을 만들 수 없습니다")

    months = pd.to_datetime(pd.Series(train_df.sort_values("period")["period"])).dt.month.to_numpy()

    x_rows, y_rows = [], []
    for i in range(max_lag, len(y)):
        x_rows.append(_features(y, i, lags, int(months[i])))
        y_rows.append(float(y[i]))

    x_train = np.asarray(x_rows, dtype=float)
    y_train = np.asarray(y_rows, dtype=float)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = _regressor(n_estimators)
            model.fit(x_train, y_train)

            # σ 계산용 적합값. 학습에 쓴 행을 그대로 예측하면 σ 가 0 으로 붕괴하므로
            # 시간 순서를 지키는 fold 로 나눠 **학습에 쓰지 않은 구간만** 예측합니다.
            fit = _out_of_fold_fit(x_train, y_train, len(y), max_lag, n_estimators)

            # 재귀 예측
            history = list(y)
            point = []
            for period in periods:
                idx = len(history)
                month = int(pd.Timestamp(period).month)
                pred = float(model.predict(np.asarray([_features(np.asarray(history), idx, lags, month)]))[0])
                pred = max(0.0, pred)
                point.append(pred)
                history.append(pred)
    except Exception as exc:
        return empty_result(f"학습에 실패했습니다: {exc}")

    return make_result(
        periods,
        np.asarray(point, dtype=float),
        fit=fit,
        explanation={
            "method": "lightgbm",
            "lags": lags,
            "n_estimators": n_estimators,
            "n_train_rows": int(len(y_train)),
            "recursive": True,
            "sigma_basis": "out_of_fold",
        },
    )
