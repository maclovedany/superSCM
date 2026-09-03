"""파이프라인 — DB 없이 검사할 수 있는 부분만.

    · applicable_demand_type 품목 필터
    · 한 모델을 전 품목에 돌렸을 때 나오는 insert 행 모양
    · 실패한 (모델, 품목) 조합이 그 조합만 건너뛰는지
    · models jsonb 이어 붙이기 (재실행 안전)
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from app import pipeline


def grid(items: dict[str, list[float]], start="2022-01-01") -> pd.DataFrame:
    frames = []
    for item_id, values in items.items():
        frames.append(
            pd.DataFrame(
                {
                    "item_id": item_id,
                    "period": pd.date_range(start=start, periods=len(values), freq="MS"),
                    "quantity": values,
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def smooth(months: int = 36) -> list[float]:
    rng = np.random.default_rng(11)
    return list(np.clip(100 + rng.normal(0, 5, months), 0, None))


def intermittent(months: int = 36) -> list[float]:
    values = [0.0] * months
    for i in range(3, months, 5):
        values[i] = 20.0
    return values


# ── 품목 필터 ─────────────────────────────────────────────────


def test_null_applicable_type_means_every_item():
    assert pipeline.item_matches("SMOOTH", None) is True
    assert pipeline.item_matches(None, None) is True
    assert pipeline.item_matches("LUMPY", []) is True


def test_applicable_type_filters_items():
    applicable = ["INTERMITTENT", "LUMPY"]
    assert pipeline.item_matches("INTERMITTENT", applicable) is True
    assert pipeline.item_matches("SMOOTH", applicable) is False


def test_unknown_demand_type_is_excluded_when_a_filter_exists():
    """수요 유형을 모르는 품목에 간헐 전용 모델을 억지로 붙이지 않습니다."""
    assert pipeline.item_matches(None, ["INTERMITTENT"]) is False


# ── 한 모델 실행 ──────────────────────────────────────────────


def test_forecast_one_model_builds_insert_rows():
    model = {
        "model_id": "CROSTON",
        "model_name": "Croston",
        "family": "INTERMITTENT",
        "version": "v1",
        "parameters": {"alpha": 0.1},
        "applicable_demand_type": ["INTERMITTENT", "LUMPY"],
    }
    data = grid({"A": intermittent(), "B": smooth()})
    demand_types = {"A": "INTERMITTENT", "B": "SMOOTH"}

    rows, summary = pipeline.forecast_one_model(model, data, horizon=6, demand_types=demand_types)

    assert summary["model_id"] == "CROSTON"
    assert summary["n_items"] == 1        # B 는 SMOOTH 라 걸러집니다
    assert summary["n_filtered"] == 1
    assert len(rows) == 6

    model_id, version, item_id, period, point, p50, p80, p90, sigma, basis = rows[0]
    assert (model_id, version, item_id) == ("CROSTON", "v1", "A")
    assert isinstance(period, __import__("datetime").date)
    assert point >= 0 and p50 == pytest.approx(point)
    if sigma is not None:
        assert p80 >= p50 and p90 >= p80
    parsed = json.loads(basis)
    assert parsed["method"] == "CROSTON"          # sql/11 의 basis 와 같은 키
    assert parsed["engine"] == "PYTHON"
    assert parsed["explanation"]["method"] == "croston"


def test_forecast_one_model_reports_unregistered_model():
    rows, summary = pipeline.forecast_one_model(
        {"model_id": "NOT_A_MODEL", "version": "v1", "parameters": {}},
        grid({"A": smooth()}),
        horizon=3,
        demand_types={},
    )
    assert rows == []
    assert "_model" in summary["skipped"]


def test_one_item_failure_does_not_stop_the_others(monkeypatch):
    """한 품목이 예외를 던져도 나머지 품목은 그대로 예측합니다 (renew.prd 31.4)."""

    def flaky(train_df, horizon, params):
        from app.models import empty_result, future_periods, make_result

        item_id = str(train_df["item_id"].iloc[0])
        if item_id == "BOOM":
            raise RuntimeError("일부러 낸 오류")
        if item_id == "EMPTY":
            return empty_result("데이터가 모자랍니다")
        return make_result(future_periods(train_df, horizon), np.full(horizon, 42.0))

    monkeypatch.setattr(pipeline.registry, "get", lambda model_id: flaky)

    data = grid({"BOOM": smooth(), "EMPTY": smooth(), "OK": smooth()})
    rows, summary = pipeline.forecast_one_model(
        {"model_id": "FLAKY", "version": "v1", "parameters": {}}, data, 4, {}
    )

    assert summary["n_items"] == 1
    assert len(rows) == 4
    assert {r[2] for r in rows} == {"OK"}
    assert set(summary["skipped"]) == {"BOOM", "EMPTY"}
    assert "일부러 낸 오류" in summary["skipped"]["BOOM"]


def test_empty_result_writes_no_rows():
    """값을 못 내면 0 이나 임의 값으로 채우지 않고 행을 만들지 않습니다."""
    model = {"model_id": "CROSTON", "version": "v1", "parameters": {"alpha": 0.1}}
    data = grid({"Z": [0.0] * 36})
    rows, summary = pipeline.forecast_one_model(model, data, 6, {})
    assert rows == []
    assert summary["n_rows"] == 0
    assert "Z" in summary["skipped"]


# ── models jsonb ──────────────────────────────────────────────


def test_merge_models_appends_and_replaces_by_model_id():
    existing = [{"model_id": "MA_3M", "n_rows": 10}, {"model_id": "ETS", "n_rows": 5}]
    merged = pipeline.merge_models_jsonb(existing, [{"model_id": "ETS", "n_rows": 7}])
    assert [m["model_id"] for m in merged] == ["MA_3M", "ETS"]
    assert merged[-1]["n_rows"] == 7


def test_merge_models_handles_json_string_and_null():
    assert pipeline.merge_models_jsonb(None, [{"model_id": "ETS"}]) == [{"model_id": "ETS"}]
    as_text = json.dumps([{"model_id": "MA_3M"}])
    assert len(pipeline.merge_models_jsonb(as_text, [{"model_id": "ETS"}])) == 2


def test_new_run_id_has_the_expected_shape():
    run_id = pipeline.new_run_id()
    assert run_id.startswith("run_py_")
    stamp, millis = run_id[len("run_py_"):].split("_")
    assert len(stamp) == 14 and stamp.isdigit()
    assert len(millis) == 3 and millis.isdigit()
