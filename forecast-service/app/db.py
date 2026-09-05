"""DB 접속 — psycopg3 · DATABASE_URL 로 직접 접속합니다.

읽는 것 (이 목록이 전부입니다)
    core.forecast_setting             학습/검증 경계 · horizon · granularity
    core.model_config                 engine='PYTHON' 인 모델과 파라미터
    core.v_demand_grid                ★ 학습 격자 (0 인 달 포함)
    core.v_data_snapshot              데이터 기준 시각 (stale 판정용)
    core.v_train_demand               격자가 비었을 때의 대체 경로
    core.forecast_run                 run 이어 붙이기
    analytics.v_sku_demand_profile    applicable_demand_type 필터용

쓰는 것
    core.forecast_run · core.forecast_result · core.model_version

★ raw 스키마는 읽지 않습니다. 학습 격리(renew.prd 7.9)는 뷰가 보장합니다.
  이 파일에 raw 스키마 이름이 등장하면 테스트가 실패합니다 (tests/test_no_raw_access.py).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

log = logging.getLogger(__name__)

CONNECT_TIMEOUT = int(os.getenv("DB_CONNECT_TIMEOUT", "5"))

# ping 결과를 이만큼 재사용합니다. /health 는 관리자 화면이 렌더될 때마다 불립니다.
# 캐시가 없으면 평범한 페이지 조회가 Supabase 에 연결 churn 을 만들고,
# DB 가 죽어 있으면 매 렌더가 connect timeout 을 통째로 기다립니다.
PING_TTL_SECONDS = float(os.getenv("DB_PING_TTL", "45"))

_ping_lock = threading.Lock()
_ping_cache: dict = {"url": None, "value": False, "at": 0.0}


def database_url() -> str | None:
    url = os.getenv("DATABASE_URL")
    return url.strip() if url and url.strip() else None


def is_configured() -> bool:
    return database_url() is not None


@contextmanager
def connect():
    """자동 커밋 연결. 파이프라인이 단계마다 커밋합니다."""
    import psycopg

    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL 이 설정되지 않았습니다")
    conn = psycopg.connect(url, connect_timeout=CONNECT_TIMEOUT, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def _ping_now() -> bool:
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1")
                cur.fetchone()
        return True
    except Exception as exc:
        log.warning("DB 접속에 실패했습니다: %s", exc)
        return False


def ping(force: bool = False) -> bool:
    """DB 가 살아 있는지. /health 는 이 값을 db 로 돌려줍니다.

    결과를 PING_TTL_SECONDS 동안 재사용합니다. DATABASE_URL 이 바뀌면 캐시를 버립니다.
    """
    url = database_url()
    if not url:
        return False

    now = time.monotonic()
    with _ping_lock:
        fresh = (
            not force
            and _ping_cache["url"] == url
            and (now - _ping_cache["at"]) < PING_TTL_SECONDS
        )
        if fresh:
            return bool(_ping_cache["value"])

    value = _ping_now()
    with _ping_lock:
        _ping_cache.update({"url": url, "value": value, "at": time.monotonic()})
    return value


def _dicts(cur) -> list[dict]:
    columns = [d.name for d in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


# ── 읽기 ──────────────────────────────────────────────────────


def fetch_setting(conn) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select granularity, train_start, train_end, test_start, test_end,
                   forecast_horizon, champion_metric,
                   coalesce(production_train_end, train_end) as production_train_end
              from core.forecast_setting
             where id = 1
            """
        )
        rows = _dicts(cur)
    return rows[0] if rows else None


def fetch_python_models(conn, only: list[str] | None = None) -> list[dict]:
    """engine='PYTHON' 이고 켜져 있는 모델. only 로 더 좁힐 수 있습니다."""
    sql = """
        select model_id, model_name, family, version, parameters, applicable_demand_type
          from core.model_config
         where enabled and engine = 'PYTHON'
    """
    args: list = []
    if only:
        sql += " and model_id = any(%s)"
        args.append(list(only))
    sql += " order by model_id"
    with conn.cursor() as cur:
        cur.execute(sql, args or None)
        return _dicts(cur)


def fetch_all_models(conn) -> list[dict]:
    """`/models` 용. engine 을 가리지 않고 전부."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select model_id, model_name, family, engine, version, enabled,
                   applicable_demand_type, parameters
              from core.model_config
             order by engine, model_id
            """
        )
        return _dicts(cur)


def fetch_grid(conn, mode: str = "VALIDATION") -> list[dict]:
    """학습 격자. 0 인 달을 포함합니다.

    VALIDATION 은 core.v_demand_grid(train_end 까지), PRODUCTION 은 core.v_forecast_grid 의
    PRODUCTION 모드(production_train_end 까지). 운영 실행에 Python 모델을 붙일 수 있게 된
    지점입니다 (실데이터 전환 Plan 2).
    """
    with conn.cursor() as cur:
        if mode == "PRODUCTION":
            cur.execute(
                "select item_id, period, quantity from core.v_forecast_grid"
                " where mode = 'PRODUCTION' order by item_id, period"
            )
        else:
            cur.execute(
                "select item_id, period, quantity from core.v_demand_grid order by item_id, period"
            )
        rows = _dicts(cur)
    if rows:
        return rows
    # 격자 뷰가 비었으면 학습 뷰를 그대로 씁니다 (0 인 달 없음).
    log.warning("core.v_demand_grid 가 비어 있어 core.v_train_demand 로 대체합니다")
    with conn.cursor() as cur:
        cur.execute(
            "select item_id, period, quantity from core.v_train_demand order by item_id, period"
        )
        return _dicts(cur)


def fetch_demand_types(conn) -> dict[str, str]:
    """item_id → demand_type. 뷰가 없거나 실패하면 빈 dict (필터를 걸지 않습니다)."""
    try:
        with conn.cursor() as cur:
            cur.execute("select item_id, demand_type from analytics.v_sku_demand_profile")
            return {str(r["item_id"]): r["demand_type"] for r in _dicts(cur) if r["demand_type"]}
    except Exception as exc:
        log.warning("수요 유형을 읽지 못했습니다. 품목 필터를 걸지 않습니다: %s", exc)
        return {}


def fetch_data_snapshot(conn):
    """데이터 자체의 기준 시각 (core.v_data_snapshot).

    sql/11 의 stale 판정이 이 값을 원본 적재 시각과 비교합니다. now() 를 넣으면
    무엇으로 학습했든 다음 적재 전까지 항상 최신으로 읽힙니다.
    서비스는 raw 를 읽지 않으므로 core 뷰 하나를 거칩니다 (sql/25).
    뷰가 아직 없으면 now() 로 폴백합니다.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("select data_snapshot_at from core.v_data_snapshot")
            row = cur.fetchone()
        if row and row[0] is not None:
            return row[0]
        log.warning("core.v_data_snapshot 이 비어 있어 현재 시각으로 대신합니다")
    except Exception as exc:
        log.warning("core.v_data_snapshot 을 읽지 못했습니다. 현재 시각으로 대신합니다: %s", exc)
    return datetime.now(timezone.utc)


def fetch_run(conn, run_id: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select run_id, status, granularity, train_start, train_end, horizon,
                   champion_metric, data_snapshot_at, models, n_models, n_items, n_rows,
                   started_at, finished_at, message, note, mode
              from core.forecast_run
             where run_id = %s
            """,
            (run_id,),
        )
        rows = _dicts(cur)
    return rows[0] if rows else None


# ── 실행 함수 호출 (전체 파이프라인 · Plan 2) ─────────────────────
#
# 직접 접속에는 문장 시간 제한이 없습니다. PostgREST RPC 는 30초 안에 끝나야 하지만
# 11,000 품목 실행은 그보다 길 수 있어 서비스가 대신 부릅니다.
# sql/25 의 core.is_admin() 이 postgres 직접 접속을 관리자로 봅니다.


def call_baseline_forecast(conn, note: str | None, mode: str) -> dict:
    """core.run_baseline_forecast(p_note, p_mode) — SQL 기준 모델 5종."""
    with conn.cursor() as cur:
        cur.execute("set statement_timeout = 0")
        cur.execute(
            "select run_id, n_models, n_items, n_rows, message"
            "  from core.run_baseline_forecast(%s, %s)",
            (note, mode),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError("run_baseline_forecast 가 결과를 돌려주지 않았습니다")
    return {"run_id": row[0], "n_models": row[1], "n_items": row[2], "n_rows": row[3], "message": row[4]}


def call_refresh_materialized(conn) -> dict:
    """core.refresh_forecast_current() · core.build_dependent_demand() — 화면이 쓰는 표 갱신 (sql/35)."""
    with conn.cursor() as cur:
        cur.execute("set statement_timeout = 0")
        cur.execute(
            "select core.refresh_forecast_current() as forecast_current,"
            "       core.build_dependent_demand()    as dependent_demand"
        )
        row = cur.fetchone()
    return {"forecast_current": int(row[0] or 0), "dependent_demand": int(row[1] or 0)}


def call_backtest(conn, forecast_run_id: str | None, note: str | None) -> dict:
    with conn.cursor() as cur:
        cur.execute("set statement_timeout = 0")
        cur.execute(
            "select backtest_run_id, n_models, n_items, n_rows, message"
            "  from core.run_backtest(%s, %s)",
            (forecast_run_id, note),
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "message": "채점 결과가 비어 있습니다"}
    return {
        "ok": bool(row[0]),
        "backtest_run_id": row[0],
        "n_models": row[1],
        "n_items": row[2],
        "n_rows": row[3],
        "message": row[4],
    }
