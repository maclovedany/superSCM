"""DB 쓰기 — 가짜 커서로 SQL 과 파라미터 개수를 맞춰봅니다.

DB 에 붙지 않고도 잡을 수 있는 것들입니다.
    · %s 자리표시자 개수 ≠ 넘긴 값 개수  (psycopg 가 런타임에야 터집니다)
    · insert 의 컬럼 개수 ≠ values 개수
    · 재실행 안전 — 같은 (run, model) 을 지우고 다시 쓰는지
"""

from __future__ import annotations

import contextlib
import datetime as dt

import pytest

from app import pipeline


class FakeCursor:
    def __init__(self, log: list, results: dict):
        self.log = log
        self.results = results
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _check(self, sql: str, params):
        placeholders = sql.count("%s")
        given = 0 if params is None else len(params)
        assert placeholders == given, f"자리표시자 {placeholders}개 ≠ 값 {given}개\n{sql}"

    def execute(self, sql, params=None):
        self._check(sql, params)
        self.log.append(("execute", " ".join(sql.split()), params))
        self._last = sql

    def executemany(self, sql, seq):
        for params in seq:
            self._check(sql, params)
        self.log.append(("executemany", " ".join(sql.split()), list(seq)))

    def fetchone(self):
        for key, value in self.results.items():
            if self._last and key in self._last:
                return value
        return None

    def fetchall(self):
        return []

    @property
    def description(self):
        return []


class FakeConn:
    def __init__(self, results: dict | None = None):
        self.log: list = []
        self.results = results or {}
        self.transactions = 0

    def cursor(self):
        return FakeCursor(self.log, self.results)

    @contextlib.contextmanager
    def transaction(self):
        self.transactions += 1
        yield self


# 이어 붙일 run 과 그때의 예측 설정. 창이 같아야 이어 붙일 수 있습니다.
SETTING = {
    "granularity": "MONTH",
    "train_start": dt.date(2023, 1, 1),
    "train_end": dt.date(2024, 12, 31),
    "test_start": dt.date(2025, 1, 1),
    "test_end": dt.date(2025, 12, 31),
    "forecast_horizon": 12,
    "champion_metric": "WAPE",
}


def sql_run(run_id="run_sql_1", **overrides) -> dict:
    run = {
        "run_id": run_id,
        "status": "SUCCESS",
        "granularity": "MONTH",
        "train_start": dt.date(2023, 1, 1),
        "train_end": dt.date(2024, 12, 31),
        "horizon": 12,
        "models": [{"model_id": "MA_3M"}],
        "message": None,
    }
    run.update(overrides)
    return run


def entries(conn, needle: str) -> list:
    return [entry for entry in conn.log if needle in entry[1]]


def test_write_results_deletes_then_inserts():
    conn = FakeConn()
    rows = [
        ("ETS", "v1", "ITEM-A", dt.date(2025, 1, 1), 10.0, 10.0, 12.0, 13.0, 2.5, "{}"),
        ("ETS", "v1", "ITEM-A", dt.date(2025, 2, 1), 10.0, 10.0, 12.0, 13.0, 2.5, "{}"),
    ]
    pipeline.write_results(conn, "run_1", "ETS", rows)

    kinds = [entry[0] for entry in conn.log]
    assert kinds == ["execute", "executemany"]
    assert conn.transactions == 1        # delete 와 insert 는 한 트랜잭션입니다

    delete_sql, delete_params = conn.log[0][1], conn.log[0][2]
    assert delete_sql.startswith("delete from core.forecast_result")
    assert delete_params == ("run_1", "ETS")

    insert_rows = conn.log[1][2]
    assert len(insert_rows) == 2
    assert insert_rows[0][0] == "run_1"
    assert len(insert_rows[0]) == 11        # run_id + 10개 컬럼


def test_write_results_with_no_rows_still_clears_the_old_ones():
    conn = FakeConn()
    pipeline.write_results(conn, "run_1", "ETS", [])
    assert [entry[0] for entry in conn.log] == ["execute"]
    assert conn.transactions == 1
    assert conn.log[0][1].startswith("delete from core.forecast_result")


def test_ensure_run_inserts_a_new_run_when_none_is_given():
    conn = FakeConn()
    run_id, created, horizon = pipeline.ensure_run(conn, None, SETTING, "메모")

    assert created is True
    assert horizon == 12
    assert run_id.startswith("run_py_")

    insert = entries(conn, "insert into core.forecast_run")
    assert len(insert) == 1
    assert insert[0][2][0] == run_id
    # data_snapshot_at 은 now() 가 아니라 데이터 시각을 읽어 넣습니다
    assert entries(conn, "core.v_data_snapshot")


def test_ensure_run_rejects_an_unknown_run_id(monkeypatch):
    monkeypatch.setattr(pipeline.db, "fetch_run", lambda conn, run_id: None)
    with pytest.raises(ValueError):
        pipeline.ensure_run(FakeConn(), "run_missing", {}, None)


def test_ensure_run_keeps_an_existing_run(monkeypatch):
    monkeypatch.setattr(pipeline.db, "fetch_run", lambda conn, run_id: sql_run(run_id, horizon=9))
    conn = FakeConn()
    run_id, created, horizon = pipeline.ensure_run(conn, "run_sql_1", SETTING, None)

    assert (run_id, created) == ("run_sql_1", False)
    assert horizon == 9          # ★ 현재 설정의 12 가 아니라 run 의 값을 씁니다
    assert conn.log == []        # 기존 run 은 건드리지 않습니다


def test_ensure_run_refuses_when_the_training_window_changed(monkeypatch):
    """설정이 바뀐 뒤 예전 run 에 붙이면 SQL 행과 Python 행이 다른 구간으로 학습됩니다."""
    monkeypatch.setattr(
        pipeline.db,
        "fetch_run",
        lambda conn, run_id: sql_run(run_id, train_end=dt.date(2024, 6, 30)),
    )
    with pytest.raises(ValueError) as caught:
        pipeline.ensure_run(FakeConn(), "run_sql_1", SETTING, None)
    assert "설정이 바뀌어" in str(caught.value)
    assert "새 run 을 만드세요" in str(caught.value)


def test_ensure_run_refuses_a_changed_granularity(monkeypatch):
    monkeypatch.setattr(
        pipeline.db, "fetch_run", lambda conn, run_id: sql_run(run_id, granularity="WEEK")
    )
    with pytest.raises(ValueError):
        pipeline.ensure_run(FakeConn(), "run_sql_1", SETTING, None)


def test_ensure_run_refuses_a_failed_run(monkeypatch):
    monkeypatch.setattr(
        pipeline.db, "fetch_run", lambda conn, run_id: sql_run(run_id, status="FAILED")
    )
    with pytest.raises(ValueError) as caught:
        pipeline.ensure_run(FakeConn(), "run_sql_1", SETTING, None)
    assert "실패한 실행" in str(caught.value)


def test_ensure_run_accepts_string_dates_from_the_driver(monkeypatch):
    """드라이버가 date 대신 문자열을 주더라도 같은 창으로 봅니다."""
    monkeypatch.setattr(
        pipeline.db,
        "fetch_run",
        lambda conn, run_id: sql_run(run_id, train_start="2023-01-01", train_end="2024-12-31"),
    )
    run_id, created, horizon = pipeline.ensure_run(FakeConn(), "run_sql_1", SETTING, None)
    assert (run_id, created, horizon) == ("run_sql_1", False, 12)


def test_register_versions_writes_one_snapshot_per_model():
    conn = FakeConn()
    pipeline.register_versions(
        conn,
        [
            {"model_id": "ETS", "version": "v1", "model_name": "지수평활", "family": "TIMESERIES"},
            {"model_id": "TSB", "version": "v1", "model_name": "TSB", "family": "INTERMITTENT"},
        ],
    )
    assert len(conn.log) == 2
    assert "on conflict do nothing" in conn.log[0][1]
    # service_version 이 들어가면 서비스를 올릴 때마다 같은 v1 에 스냅샷이 하나씩 더 생깁니다
    assert "service_version" not in conn.log[0][2][2]


def test_finalize_run_merges_models_and_recounts(monkeypatch):
    monkeypatch.setattr(
        pipeline.db,
        "fetch_run",
        lambda conn, run_id: {
            "run_id": run_id,
            "status": "SUCCESS",
            "message": "SQL 60행",
            "models": [{"model_id": "MA_3M"}],
        },
    )
    conn = FakeConn(results={"count(*)": (96, 8)})
    totals = pipeline.finalize_run(conn, "run_sql_1", [{"model_id": "ETS", "n_rows": 36}], False, "Python 36행")

    assert totals == {"n_models": 2, "n_items": 8, "n_rows": 96}
    update = [entry for entry in conn.log if "update core.forecast_run" in entry[1]][0]
    params = update[2]
    assert params[1] == 2                       # n_models = 합친 models 배열 길이
    assert params[4] == "SUCCESS"               # 이어 붙인 run 의 상태는 그대로 둡니다
    assert "SQL 60행 · Python 36행" == params[5]


def test_finalize_run_marks_a_new_empty_run_as_failed(monkeypatch):
    monkeypatch.setattr(
        pipeline.db, "fetch_run", lambda conn, run_id: {"run_id": run_id, "status": "RUNNING", "models": []}
    )
    conn = FakeConn(results={"count(*)": (0, 0)})
    pipeline.finalize_run(conn, "run_py_1", [{"model_id": "ETS", "n_rows": 0}], True, "0행")
    update = [entry for entry in conn.log if "update core.forecast_run" in entry[1]][0]
    assert update[2][4] == "FAILED"


def test_fail_run_does_not_downgrade_an_appended_run():
    """SQL 결과가 유효한 run 은 Python 이 실패해도 상태를 내리지 않습니다 (renew.prd 31.4)."""
    conn = FakeConn()
    pipeline.fail_run(conn, "run_sql_1", False, "서비스 오류")
    sql = conn.log[0][1]
    assert "status" not in sql
    assert "message" in sql

    conn2 = FakeConn()
    pipeline.fail_run(conn2, "run_py_1", True, "서비스 오류")
    assert "status = 'FAILED'" in conn2.log[0][1]


# ── 전체 실행 경로 ────────────────────────────────────────────


def fake_connect(conn):
    """db.connect() 자리에 끼울 컨텍스트 매니저."""
    import contextlib

    @contextlib.contextmanager
    def _connect():
        yield conn

    return _connect


def test_execute_runs_every_model_and_finalizes_the_run(monkeypatch):
    import numpy as np
    import pandas as pd

    periods = pd.date_range("2023-01-01", periods=36, freq="MS")
    rng = np.random.default_rng(5)
    grid_rows = []
    for item_id, base in (("ITEM-A", 100.0), ("ITEM-B", 40.0)):
        for period, noise in zip(periods, rng.normal(0, 3, len(periods))):
            grid_rows.append(
                {"item_id": item_id, "period": period.date(), "quantity": max(0.0, base + noise)}
            )

    conn = FakeConn(results={"count(*)": (24, 2)})

    monkeypatch.setattr(pipeline.db, "connect", fake_connect(conn))
    monkeypatch.setattr(pipeline.db, "fetch_setting", lambda c: SETTING)
    monkeypatch.setattr(
        pipeline.db,
        "fetch_python_models",
        lambda c, only=None: [
            {
                "model_id": "ETS",
                "model_name": "지수평활",
                "family": "TIMESERIES",
                "version": "v1",
                "parameters": {"alpha": 0.3},
                "applicable_demand_type": None,
            }
        ],
    )
    monkeypatch.setattr(pipeline.db, "fetch_grid", lambda c: grid_rows)
    monkeypatch.setattr(pipeline.db, "fetch_demand_types", lambda c: {})
    monkeypatch.setattr(pipeline.db, "fetch_run", lambda c, run_id: sql_run(run_id))

    result = pipeline.execute("run_sql_1", created=False, only=None)

    assert result["status"] == "SUCCESS"
    assert result["n_models"] == 1
    assert result["models"][0]["model_id"] == "ETS"
    assert result["models"][0]["n_items"] == 2
    assert result["models"][0]["n_rows"] == 24        # 품목 2개 × 12개월

    inserted = [entry for entry in conn.log if entry[0] == "executemany"]
    assert len(inserted) == 1
    assert len(inserted[0][2]) == 24

    # 서비스 안의 작업 상태도 갱신됩니다
    assert pipeline.get_job("run_sql_1")["status"] == "SUCCESS"


def test_execute_records_failure_without_raising(monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(pipeline.db, "connect", fake_connect(conn))
    monkeypatch.setattr(
        pipeline.db, "fetch_setting", lambda c: (_ for _ in ()).throw(RuntimeError("DB 접속 실패"))
    )

    result = pipeline.execute("run_sql_2", created=False, only=None)

    assert result["status"] == "FAILED"
    assert "DB 접속 실패" in result["message"]
    assert pipeline.get_job("run_sql_2")["status"] == "FAILED"


# ── ping 캐시 ─────────────────────────────────────────────────


def test_ping_is_cached_between_calls(monkeypatch):
    """관리자 화면은 렌더마다 /health 를 부릅니다. 매번 새 연결을 열면 안 됩니다."""
    from app import db

    calls = {"n": 0}

    def counted():
        calls["n"] += 1
        return True

    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")
    monkeypatch.setattr(db, "_ping_now", counted)
    db._ping_cache.update({"url": None, "value": False, "at": 0.0})

    assert db.ping() is True
    assert db.ping() is True
    assert db.ping() is True
    assert calls["n"] == 1

    assert db.ping(force=True) is True
    assert calls["n"] == 2


def test_ping_cache_is_dropped_when_the_url_changes(monkeypatch):
    from app import db

    calls = {"n": 0}

    def counted():
        calls["n"] += 1
        return True

    monkeypatch.setattr(db, "_ping_now", counted)
    db._ping_cache.update({"url": None, "value": False, "at": 0.0})

    monkeypatch.setenv("DATABASE_URL", "postgresql://one/db")
    db.ping()
    monkeypatch.setenv("DATABASE_URL", "postgresql://two/db")
    db.ping()
    assert calls["n"] == 2

    # 설정이 사라지면 연결을 시도하지 않습니다
    monkeypatch.delenv("DATABASE_URL")
    assert db.ping() is False
    assert calls["n"] == 2
