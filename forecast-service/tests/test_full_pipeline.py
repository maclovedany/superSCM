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
        lambda conn, run_id=None: (calls.append(("refresh",)) or {"forecast_current": 40, "dependent_demand": 7, "pruned_rows": 0, "pruned_runs": 0}),
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


def test_status_by_pipeline_id_shows_python_progress(monkeypatch):
    """pipeline id 로 물어도 run_id 쪽 job 에 쌓인 모델 진행률이 보여야 합니다."""
    monkeypatch.setattr(pipeline.db, "connect", fake_conn)
    monkeypatch.setattr(pipeline.db, "fetch_run", lambda conn, run_id: None)
    pipeline.set_job("pipe_t6", status="RUNNING", stage="PYTHON", target_run_id="run_p6", message="Python 모델 실행 중")
    pipeline.set_job("run_p6", progress={"model": "ETS", "model_index": 2, "model_total": 7, "items_seen": 500, "items_total": 9772})
    status = pipeline.run_status("pipe_t6")
    assert status["run_id"] == "run_p6"
    assert status["stage"] == "PYTHON"
    assert status["progress"]["items_seen"] == 500


def test_time_budget_skips_small_items_first(monkeypatch):
    """예산을 넘기면 총량이 작은 품목부터 건너뛰고, 건너뛴 수와 사유를 남깁니다."""
    import time as _time
    import numpy as np
    import pandas as pd
    from app.models import future_periods, make_result

    def slow(train_df, horizon, params):
        _time.sleep(0.02)
        return make_result(future_periods(train_df, horizon), np.full(horizon, 1.0))

    monkeypatch.setattr(pipeline.registry, "get", lambda model_id: slow)
    frames = [pd.DataFrame({"item_id": f"I{i:02d}", "period": pd.date_range("2025-01-01", periods=6, freq="MS"),
                            "quantity": [float(100 - i)] * 6}) for i in range(30)]
    grid = pd.concat(frames, ignore_index=True)
    rows, summary = pipeline.forecast_one_model({"model_id": "SLOW", "version": "v1", "parameters": {}}, grid, 1, {},
                                                budget_seconds=0.1)
    done = {r[2] for r in rows}
    assert "I00" in done                       # 총량이 가장 큰 품목은 먼저 끝났습니다
    assert summary["n_time_budget"] > 0
    assert "TIME_BUDGET" in summary["skipped"]["_budget"]
    assert summary["n_items"] + summary["n_time_budget"] == 30


def test_running_pipeline_is_detected_and_cleared():
    with pipeline._JOBS_LOCK:
        pipeline._JOBS.clear()          # 앞 테스트가 남긴 RUNNING job 과 섞이지 않게
    pipeline.set_job("pipe_busy", status="RUNNING", stage="PYTHON")
    assert pipeline.running_pipeline()["run_id"] == "pipe_busy"
    pipeline.set_job("pipe_busy", status="SUCCESS", stage="DONE")
    assert pipeline.running_pipeline() is None


def test_production_scope_limits_items_to_champion_or_default(monkeypatch):
    """운영 실행: 모델이 그 품목의 Champion 이거나 기본 모델일 때만 계산한다 (error.md #35)."""
    import numpy as np
    import pandas as pd
    from app.models import future_periods, make_result

    monkeypatch.setattr(pipeline.registry, "get", lambda model_id: (
        lambda train_df, horizon, params: make_result(future_periods(train_df, horizon), np.full(horizon, 1.0))))
    grid = pd.DataFrame({
        "item_id": ["A"] * 4 + ["B"] * 4 + ["C"] * 4,
        "period": list(pd.date_range("2025-01-01", periods=4, freq="MS")) * 3,
        "quantity": [1.0] * 12,
    })
    model = {"model_id": "SCOPED", "version": "v1", "parameters": {}}
    scope = {"default_model": "MA_3M", "champions": {"A": "SCOPED", "B": "ETS"}}

    rows, summary = pipeline.forecast_one_model(model, grid, 2, {}, scope=scope)
    assert {r[2] for r in rows} == {"A"}            # B 는 다른 Champion, C 는 Champion 없음 → 기본 모델만
    assert summary["n_out_of_scope"] == 2

    rows_all, summary_all = pipeline.forecast_one_model(model, grid, 2, {}, scope=None)
    assert {r[2] for r in rows_all} == {"A", "B", "C"}   # 검증 실행은 전부
    assert summary_all["n_out_of_scope"] == 0

    default_scope = {"default_model": "SCOPED", "champions": {"A": "ETS"}}
    rows_def, _ = pipeline.forecast_one_model(model, grid, 2, {}, scope=default_scope)
    assert {r[2] for r in rows_def} == {"A", "B", "C"}   # 기본 모델은 모든 품목
