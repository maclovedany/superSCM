"""registry — Plug-in 계약 (renew.prd 11.2).

새 모델은 `app/models/` 에 파일 하나를 넣는 것으로 끝나야 합니다.
파이프라인이 모델을 부르는 방법은 시그니처 하나뿐입니다.
"""

from __future__ import annotations

import inspect

import numpy as np
import pandas as pd

from app import registry

# 선택 의존성이 없어도 반드시 있어야 하는 모델
ALWAYS_AVAILABLE = {"ETS", "HOLT_WINTERS", "SARIMA", "CROSTON", "SBA", "TSB"}


def test_core_models_are_registered():
    assert ALWAYS_AVAILABLE.issubset(set(registry.model_ids()))


def test_every_model_has_the_plugin_signature():
    for model_id, fn in registry.load().items():
        params = list(inspect.signature(fn).parameters)
        assert params[:3] == ["train_df", "horizon", "params"], model_id


def test_optional_models_are_registered_or_reported_as_skipped():
    """lightgbm · prophet 이 없으면 등록되지 않고 사유가 남습니다. 예외로 죽지 않습니다."""
    skipped = registry.skipped()
    assert isinstance(skipped, dict)
    for model_id, module_name in (("LIGHTGBM", "lightgbm_model"), ("PROPHET", "prophet_model")):
        if model_id not in registry.model_ids():
            assert module_name in skipped, f"{model_id} 가 없으면 사유가 남아야 합니다"
            assert skipped[module_name]


def test_registry_caches_and_reloads():
    first = registry.load()
    assert registry.load() is first
    reloaded = registry.load(reload=True)
    assert set(reloaded) == set(first)


def test_every_registered_model_returns_a_dataframe_with_the_contract():
    periods = pd.date_range("2021-01-01", periods=48, freq="MS")
    rng = np.random.default_rng(3)
    quantity = np.clip(
        80 + 10 * np.sin(2 * np.pi * np.arange(48) / 12) + rng.normal(0, 4, 48), 0, None
    )
    train_df = pd.DataFrame({"item_id": "ITEM-R", "period": periods, "quantity": quantity})

    for model_id, fn in registry.load().items():
        result = fn(train_df, 6, {})
        assert isinstance(result, pd.DataFrame), model_id
        assert list(result.columns) == ["period", "predicted_qty"], model_id
        if len(result) == 0:
            assert "reason" in result.attrs, model_id
        else:
            assert np.isfinite(result["predicted_qty"].to_numpy(dtype=float)).all(), model_id
