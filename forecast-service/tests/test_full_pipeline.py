"""전체 파이프라인(run_full) — DB 없이 단계 순서와 상태 전이를 검사합니다.

    · VALIDATION: SQL → Python → 실체화 → 백테스트 → 실체화
    · PRODUCTION: 백테스트 없음
    · SQL 이 0행이면 FAILED, Python 이 실패해도 파이프라인은 계속 (renew.prd 31.4)
    · pipeline id 로도 run_id 로도 같은 진행 상황이 보인다
    · 운영 run 의 학습 창 검사는 production_train_end 와 견준다
"""

from __future__ import annotations

import contextlib

import pytest

from app import pipeline


@contextlib.contextmanager
def fake_conn():
    yield object()


def _wire(monkeypatch, calls: list, baseline_rows=100, python_status="SUCCESS"):
    monkeypatch.setattr(pipeline.db, "connect", fake_conn)
    monkeypatch.setattr(
        pipeline.db, "call_baseline_forecast",
        lambda conn, note, mode: (calls.append(("baseline", mode)) or
                                  {"run_id": "run_x", "n_models": 5, "n_items": 10, "n_rows": baseline_rows, "message": "ok"}),
    )
    monkeypatch.setattr(
        pipeline, "execute",
        lambda run_id, created, only=None: (calls.append(("python", run_id, created)) or
                                            {"status": python_status, "n_models": 3, "n_rows": 30, "message": "py"}),
    )
    monkeypatch.setattr(
        pipeline.db, "call_refresh_materialized",
        lambda conn: (calls.append(("refresh",)) or {"forecast_current": 40, "dependent_demand": 7}),
    )
    monkeypatch.setattr(
        pipeline.db, "call_backtest",
        lambda conn, run_id, note: (calls.append(("backtest", run_id)) or
                                    {"ok": True, "backtest_run_id": "bt_x", "n_models": 8, "n_items": 10, "n_rows": 80, "message": "scored"}),
    )


def test_validation_runs_every_stage_in_order(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    result = pipeline.run_full("pipe_t1", "VALIDATION", "메모")
    assert result["status"] == "SUCCESS"
    assert [c[0] for c in calls] == ["baseline", "python", "refresh", "backtest", "refresh"]
    assert calls[1] == ("python", "run_x", False)      # SQL 이 만든 run 에 이어 붙입니다
    assert result["backtest"]["n_rows"] == 80
    assert "백테스트 80행" in result["message"]


def test_production_skips_the_backtest(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    result = pipeline.run_full("pipe_t2", "production", None)
    assert result["status"] == "SUCCESS"
    assert [c[0] for c in calls] == ["baseline", "python", "refresh"]
    assert calls[0] == ("baseline", "PRODUCTION")
    assert result["backtest"] is None


def test_empty_sql_result_fails_the_pipeline(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls, baseline_rows=0)
    result = pipeline.run_full("pipe_t3", "VALIDATION", None)
    assert result["status"] == "FAILED"
    assert [c[0] for c in calls] == ["baseline"]


def test_python_failure_does_not_stop_materialization(monkeypatch):
    """Python 모델이 죽어도 SQL 결과는 유효하므로 표 갱신과 백테스트는 계속합니다."""
    calls: list = []
    _wire(monkeypatch, calls, python_status="FAILED")
    result = pipeline.run_full("pipe_t4", "VALIDATION", None)
    assert result["status"] == "SUCCESS"
    assert "refresh" in [c[0] for c in calls] and "backtest" in [c[0] for c in calls]
    assert pipeline.get_job("pipe_t4")["python_error"] == "py"


def test_pipeline_id_and_run_id_show_the_same_job(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    pipeline.run_full("pipe_t5", "VALIDATION", None)
    by_pipe = pipeline.get_job("pipe_t5")
    by_run = pipeline.get_job("run_x")
    assert by_run["pipeline_id"] == "pipe_t5"
    assert by_run["status"] == by_pipe["status"] == "SUCCESS"
    assert by_run["stage"] == "DONE"


def test_production_window_check_uses_production_train_end():
    setting = {"granularity": "MONTH", "train_start": "2020-01-01", "train_end": "2025-12-31",
               "production_train_end": "2026-07-01"}
    prod_run = {"mode": "PRODUCTION", "granularity": "MONTH", "train_start": "2020-01-01", "train_end": "2026-07-01"}
    pipeline.check_run_window(prod_run, setting)              # 통과해야 합니다
    val_run = {"mode": "VALIDATION", "granularity": "MONTH", "train_start": "2020-01-01", "train_end": "2026-07-01"}
    with pytest.raises(ValueError):
        pipeline.check_run_window(val_run, setting)           # 검증 run 은 train_end 와 견줍니다


def test_progress_callback_fires_every_500_items(monkeypatch):
    import numpy as np
    import pandas as pd
    from app.models import future_periods, make_result

    monkeypatch.setattr(pipeline.registry, "get", lambda model_id: (
        lambda train_df, horizon, params: make_result(future_periods(train_df, horizon), np.full(horizon, 1.0))))
    items = {f"I{i:04d}": [1.0] * 6 for i in range(1200)}
    frames = [pd.DataFrame({"item_id": k, "period": pd.date_range("2025-01-01", periods=6, freq="MS"), "quantity": v})
              for k, v in items.items()]
    grid = pd.concat(frames, ignore_index=True)
    seen: list = []
    pipeline.forecast_one_model({"model_id": "X", "version": "v1", "parameters": {}}, grid, 2, {},
                                progress=lambda s, t: seen.append((s, t)))
    assert seen == [(500, 1200), (1000, 1200)]
