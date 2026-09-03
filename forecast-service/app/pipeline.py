"""파이프라인 — run 이어 붙이기 · 예측 · 결과 write.

핵심은 **같은 run_id 에 이어 붙이는 것** 입니다. SQL Baseline 이 만든 run 에 Python 모델
결과를 더하면, STEP 7 의 core.run_backtest 가 SQL 모델과 Python 모델을 **같은 학습 구간 ·
같은 검증 구간 · 같은 스냅샷** 으로 채점하고 Champion 을 뽑습니다 (renew.prd 13 · 14).

재실행 안전
    같은 (run_id, model_id) 로 다시 돌리면 그 모델의 기존 행을 지우고 다시 씁니다.

실패 격리 (renew.prd 31.4)
    한 모델 · 한 품목의 실패는 그 조합만 건너뜁니다. 서비스도 run 도 죽지 않습니다.
    건너뛴 사유는 run 의 models jsonb (skipped) 와 message 에 남습니다.
"""

from __future__ import annotations

import json
import logging
import threading
import traceback
from datetime import date, datetime, timezone

import pandas as pd

from . import __version__, db, registry
from .intervals import quantiles, residual_sigma

log = logging.getLogger(__name__)

# 서비스가 진행 중인 작업. GET /forecast/run/{run_id} 가 DB 정보와 합쳐 돌려줍니다.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

# 사유 문자열을 이 길이로 자릅니다 (message 가 무한정 길어지지 않도록).
REASON_MAX = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_run_id() -> str:
    now = _now()
    return f"run_py_{now.strftime('%Y%m%d%H%M%S')}_{now.microsecond // 1000:03d}"


def set_job(run_id: str, /, **fields) -> dict:
    # run_id 는 위치 인자로만 받습니다 (`/`). 결과 dict 를 **로 통째로 넘겨도 충돌하지 않습니다.
    fields.pop("run_id", None)
    with _JOBS_LOCK:
        job = _JOBS.setdefault(run_id, {"run_id": run_id})
        job.update(fields)
        return dict(job)


def get_job(run_id: str) -> dict | None:
    with _JOBS_LOCK:
        job = _JOBS.get(run_id)
        return dict(job) if job else None


# ── 품목 필터 ─────────────────────────────────────────────────


def item_matches(demand_type: str | None, applicable: list[str] | None) -> bool:
    """applicable_demand_type 이 null 이면 전 품목. 있으면 그 유형만 (renew.prd 11.3)."""
    if not applicable:
        return True
    if not demand_type:
        # 수요 유형을 모르는 품목에 간헐 전용 모델을 억지로 붙이지 않습니다.
        return False
    return demand_type in applicable


# ── 한 모델 실행 ──────────────────────────────────────────────


def forecast_one_model(
    model: dict,
    grid: pd.DataFrame,
    horizon: int,
    demand_types: dict[str, str],
) -> tuple[list[tuple], dict]:
    """한 모델을 전 품목에 돌립니다. (insert 할 행, 요약) 을 돌려줍니다."""
    model_id = str(model["model_id"])
    version = str(model.get("version") or "v1")
    params = model.get("parameters") or {}
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except ValueError:
            params = {}
    applicable = model.get("applicable_demand_type")

    fn = registry.get(model_id)
    if fn is None:
        return [], {
            "model_id": model_id,
            "n_rows": 0,
            "n_items": 0,
            "skipped": {"_model": f"{model_id} 는 서비스에 등록되어 있지 않습니다"},
        }

    rows: list[tuple] = []
    skipped: dict[str, str] = {}
    items_done = 0
    filtered = 0

    for item_id, item_df in grid.groupby("item_id", sort=True):
        item_id = str(item_id)
        if not item_matches(demand_types.get(item_id), applicable):
            filtered += 1
            continue
        try:
            result = fn(item_df[["item_id", "period", "quantity"]], horizon, params)
        except Exception as exc:  # 이 조합만 건너뜁니다
            skipped[item_id] = f"{type(exc).__name__}: {exc}"[:REASON_MAX]
            log.warning("%s · %s 예측에 실패했습니다: %s", model_id, item_id, exc)
            continue

        if result is None or len(result) == 0:
            reason = (result.attrs.get("reason") if result is not None else None) or "값을 낼 수 없습니다"
            skipped[item_id] = str(reason)[:REASON_MAX]
            continue

        sigma = residual_sigma(
            item_df.sort_values("period")["quantity"].to_numpy(dtype=float),
            result.attrs.get("fit"),
        )
        # 위 4개 키는 sql/11 의 basis 와 같은 모양입니다. 모델별 근거는 explanation 아래에 둡니다.
        basis = {
            "method": model_id,
            "engine": "PYTHON",
            "interval": "normal-approx" if sigma is not None else "unavailable",
            "service_version": __version__,
            "explanation": result.attrs.get("explanation") or {},
        }
        basis_json = json.dumps(basis, ensure_ascii=False, default=str)

        for record in result.itertuples(index=False):
            point = float(record.predicted_qty)
            p50, p80, p90 = quantiles(point, sigma)
            period = pd.Timestamp(record.period).date()
            rows.append(
                (
                    model_id,
                    version,
                    item_id,
                    period,
                    round(point, 2),
                    None if p50 is None else round(p50, 2),
                    None if p80 is None else round(p80, 2),
                    None if p90 is None else round(p90, 2),
                    None if sigma is None else round(sigma, 3),
                    basis_json,
                )
            )
        items_done += 1

    summary = {
        "model_id": model_id,
        "version": version,
        "parameters": params,
        "n_rows": len(rows),
        "n_items": items_done,
        "n_filtered": filtered,
    }
    if skipped:
        # 전부 나열하면 jsonb 가 커집니다. 앞 20건만 남깁니다.
        summary["skipped"] = dict(list(skipped.items())[:20])
        summary["n_skipped"] = len(skipped)
    return rows, summary


# ── DB 쓰기 ───────────────────────────────────────────────────


def _as_date(value):
    """date · datetime · 'YYYY-MM-DD' 를 date 로 맞춥니다 (비교용)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return pd.Timestamp(value).date()
    except (TypeError, ValueError):
        return None


def check_run_window(run: dict, setting: dict) -> None:
    """이어 붙일 run 의 학습 창이 지금 설정과 같은지 봅니다.

    학습 격자(core.v_demand_grid)는 **현재** core.forecast_setting 에서 파생됩니다.
    설정이 바뀐 뒤 예전 run 에 이어 붙이면 같은 run_id 안에서 SQL 행과 Python 행이
    서로 다른 학습 구간으로 학습되고 서로 다른 기간을 덮습니다. 이어 붙이기가 존재하는
    유일한 이유("같은 조건")가 깨지므로 거절합니다.
    """
    mismatched = []
    for label, run_key, setting_key in (
        ("학습 시작", "train_start", "train_start"),
        ("학습 종료", "train_end", "train_end"),
    ):
        if _as_date(run.get(run_key)) != _as_date(setting.get(setting_key)):
            mismatched.append(f"{label} {run.get(run_key)} → {setting.get(setting_key)}")

    if str(run.get("granularity") or "") != str(setting.get("granularity") or ""):
        mismatched.append(f"단위 {run.get('granularity')} → {setting.get('granularity')}")

    if mismatched:
        raise ValueError(
            "설정이 바뀌어 이 run 에 이어 붙일 수 없습니다. 새 run 을 만드세요 ("
            + ", ".join(mismatched)
            + ")"
        )


def ensure_run(conn, run_id: str | None, setting: dict, note: str | None) -> tuple[str, bool, int]:
    """(run_id, 이번에 새로 만들었는가, horizon).

    기존 run 이면 **그 run 의 horizon** 을 씁니다. 현재 설정의 horizon 이 아닙니다.
    """
    if run_id:
        existing = db.fetch_run(conn, run_id)
        if not existing:
            raise ValueError(f"예측 실행 {run_id} 을(를) 찾을 수 없습니다")
        if str(existing.get("status")) == "FAILED":
            raise ValueError(
                f"실패한 실행 {run_id} 에는 이어 붙일 수 없습니다. 예측을 다시 실행하세요"
            )
        check_run_window(existing, setting)
        return run_id, False, int(existing["horizon"])

    new_id = new_run_id()
    # 데이터 자체의 시각. core.v_data_snapshot 이 없으면 now() 로 폴백합니다.
    snapshot = db.fetch_data_snapshot(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into core.forecast_run
              (run_id, status, granularity, train_start, train_end, horizon,
               champion_metric, data_snapshot_at, models, n_models, note)
            values (%s, 'RUNNING', %s, %s, %s, %s, %s, %s, '[]'::jsonb, 0, %s)
            """,
            (
                new_id,
                setting["granularity"],
                setting["train_start"],
                setting["train_end"],
                setting["forecast_horizon"],
                setting["champion_metric"],
                snapshot,
                note,
            ),
        )
    return new_id, True, int(setting["forecast_horizon"])


def register_versions(conn, models: list[dict]) -> None:
    """renew.prd 12.2 재현성 — 실행 시점의 모델 정의를 스냅샷으로 남깁니다."""
    with conn.cursor() as cur:
        for model in models:
            # ★ service_version 을 넣지 않습니다. unique 제약이 (model_id, version, definition)
            #   이라 서비스를 올릴 때마다 같은 v1 에 스냅샷이 하나씩 더 생기고
            #   관리자 화면의 version_count 가 부풀어 오릅니다. 서비스 버전은 basis 에만 남깁니다.
            definition = {
                "model_name": model.get("model_name"),
                "family": model.get("family"),
                "engine": "PYTHON",
                "parameters": model.get("parameters") or {},
            }
            cur.execute(
                """
                insert into core.model_version (model_id, version, definition)
                values (%s, %s, %s::jsonb)
                on conflict do nothing
                """,
                (model["model_id"], model.get("version") or "v1", json.dumps(definition, ensure_ascii=False)),
            )


def write_results(conn, run_id: str, model_id: str, rows: list[tuple]) -> None:
    """같은 (run, model) 의 기존 행을 지우고 다시 씁니다 (재실행 안전).

    delete 와 insert 를 한 트랜잭션으로 묶습니다. 연결이 autocommit 이라 묶지 않으면
    그 사이에 죽었을 때 그 모델 행만 run 에서 사라집니다.
    """
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "delete from core.forecast_result where run_id = %s and model_id = %s",
            (run_id, model_id),
        )
        if not rows:
            return
        cur.executemany(
            """
            insert into core.forecast_result
              (run_id, model_id, model_version, item_id, period,
               predicted_qty, p50, p80, p90, sigma, basis)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [(run_id, *row) for row in rows],
        )


def merge_models_jsonb(existing, summaries: list[dict]) -> list[dict]:
    """기존 models 배열에서 같은 model_id 를 빼고 이번 결과를 덧붙입니다."""
    if isinstance(existing, str):
        try:
            existing = json.loads(existing)
        except ValueError:
            existing = []
    if not isinstance(existing, list):
        existing = []
    new_ids = {s["model_id"] for s in summaries}
    kept = [m for m in existing if isinstance(m, dict) and m.get("model_id") not in new_ids]
    return kept + summaries


def finalize_run(conn, run_id: str, summaries: list[dict], created: bool, message: str) -> dict:
    """models jsonb 를 합치고 n_models · n_items · n_rows 를 다시 셉니다."""
    run = db.fetch_run(conn, run_id) or {}
    merged = merge_models_jsonb(run.get("models"), summaries)

    with conn.cursor() as cur:
        cur.execute(
            "select count(*), count(distinct item_id) from core.forecast_result where run_id = %s",
            (run_id,),
        )
        n_rows, n_items = cur.fetchone()

        prior = str(run.get("message") or "").strip()
        combined = message if (created or not prior) else f"{prior} · {message}"
        status = run.get("status") or "RUNNING"
        if created:
            status = "SUCCESS" if n_rows else "FAILED"

        cur.execute(
            """
            update core.forecast_run as r
               set models      = %s::jsonb,
                   n_models    = %s,
                   n_items     = %s,
                   n_rows      = %s,
                   status      = %s,
                   finished_at = now(),
                   message     = %s
             where r.run_id = %s
            """,
            (
                json.dumps(merged, ensure_ascii=False, default=str),
                len(merged),
                n_items,
                n_rows,
                status,
                combined[:2000],
                run_id,
            ),
        )
    return {"n_models": len(merged), "n_items": int(n_items or 0), "n_rows": int(n_rows or 0)}


def fail_run(conn, run_id: str, created: bool, message: str) -> None:
    """새로 만든 run 만 FAILED 로 내립니다.

    이어 붙인 run 은 SQL Baseline 의 결과가 이미 유효하므로 상태를 건드리지 않습니다
    (renew.prd 31.4 — 예측 서비스가 죽어도 저장된 결과는 계속 조회됩니다).
    """
    with conn.cursor() as cur:
        if created:
            cur.execute(
                """update core.forecast_run as r
                      set status = 'FAILED', finished_at = now(), message = %s
                    where r.run_id = %s""",
                (message[:2000], run_id),
            )
        else:
            cur.execute(
                """update core.forecast_run as r
                      set message = trim(both ' ·' from coalesce(r.message, '') || ' · ' || %s)
                    where r.run_id = %s""",
                (message[:2000], run_id),
            )


# ── 진입점 ────────────────────────────────────────────────────


def prepare(run_id: str | None, note: str | None, only: list[str] | None) -> dict:
    """실행 직전 검사. 즉시 응답으로 돌려줄 정보를 만듭니다 (BackgroundTask 전에 호출)."""
    with db.connect() as conn:
        setting = db.fetch_setting(conn)
        if not setting:
            raise ValueError("예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요")

        configs = db.fetch_python_models(conn, only)
        available = [m for m in configs if registry.has(str(m["model_id"]))]
        if not available:
            missing = [str(m["model_id"]) for m in configs if not registry.has(str(m["model_id"]))]
            detail = f" (모델 설정에는 있으나 서비스에 없는 모델: {', '.join(missing)})" if missing else ""
            raise ValueError(f"실행할 수 있는 Python 모델이 없습니다{detail}")

        resolved, created, horizon = ensure_run(conn, run_id, setting, note)

    return {
        "run_id": resolved,
        "created": created,
        "models": [str(m["model_id"]) for m in available],
        "horizon": horizon,
    }


def execute(run_id: str, created: bool, only: list[str] | None = None) -> dict:
    """실제 실행. BackgroundTask 에서 돕니다.

    note 는 prepare() 가 새 run 을 만들 때 이미 저장했으므로 여기서는 쓰지 않습니다.
    """
    set_job(run_id, status="RUNNING", started_at=_now().isoformat(), message="실행 중입니다")
    try:
        with db.connect() as conn:
            setting = db.fetch_setting(conn)
            if not setting:
                raise ValueError("예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요")

            # ★ horizon 은 이어 붙일 run 의 값을 씁니다. 그 사이 설정이 바뀌었으면 여기서 멈춥니다.
            if created:
                horizon = int(setting["forecast_horizon"])
            else:
                run = db.fetch_run(conn, run_id)
                if not run:
                    raise ValueError(f"예측 실행 {run_id} 을(를) 찾을 수 없습니다")
                check_run_window(run, setting)
                horizon = int(run["horizon"])

            configs = [
                m for m in db.fetch_python_models(conn, only) if registry.has(str(m["model_id"]))
            ]
            register_versions(conn, configs)

            grid_rows = db.fetch_grid(conn)
            if not grid_rows:
                raise ValueError("학습 격자가 비어 있습니다 (core.v_demand_grid)")
            grid = pd.DataFrame(grid_rows)
            grid["period"] = pd.to_datetime(grid["period"])
            grid["quantity"] = pd.to_numeric(grid["quantity"], errors="coerce").fillna(0.0)

            demand_types = db.fetch_demand_types(conn)

            summaries: list[dict] = []
            for model in configs:
                model_id = str(model["model_id"])
                set_job(run_id, message=f"{model_id} 실행 중입니다")
                rows, summary = forecast_one_model(model, grid, horizon, demand_types)
                write_results(conn, run_id, model_id, rows)
                summaries.append(summary)
                log.info("%s · %s: %d행", run_id, model_id, len(rows))

            produced = sum(s["n_rows"] for s in summaries)
            names = ", ".join(f"{s['model_id']}({s['n_rows']}행)" for s in summaries)
            message = f"Python 모델 {len(summaries)}종 {produced}행을 추가했습니다 · {names}"
            totals = finalize_run(conn, run_id, summaries, created, message)

        result = {
            "run_id": run_id,
            "status": "SUCCESS",
            "n_models": len(summaries),
            "n_items": totals["n_items"],
            "n_rows": totals["n_rows"],
            "n_python_rows": produced,
            "models": summaries,
            "message": message,
            "finished_at": _now().isoformat(),
        }
        set_job(run_id, **result)
        return result
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        log.error("%s 실행에 실패했습니다: %s\n%s", run_id, detail, traceback.format_exc())
        try:
            with db.connect() as conn:
                fail_run(conn, run_id, created, f"Python 모델 실행에 실패했습니다: {detail}")
        except Exception as inner:
            log.error("실패 상태를 기록하지 못했습니다: %s", inner)
        result = {
            "run_id": run_id,
            "status": "FAILED",
            "message": f"Python 모델 실행에 실패했습니다: {detail}",
            "finished_at": _now().isoformat(),
        }
        set_job(run_id, **result)
        return result


def run_backtest(forecast_run_id: str | None, note: str | None = None) -> dict:
    """STEP 7 의 core.run_backtest 를 부릅니다.

    직접 접속에는 auth.uid() 가 없습니다. sql/25-python-models.sql 이 core.is_admin() 을
    확장해 직접 접속(session_user 가 authenticator/anon/authenticated 가 아닌 경우)을
    관리자로 봅니다. PostgREST 경로에는 이 조건이 절대 참이 되지 않습니다.
    """
    with db.connect() as conn:
        with conn.cursor() as cur:
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


def run_status(run_id: str) -> dict:
    """GET /forecast/run/{run_id} — DB 의 run 과 서비스 작업 상태를 합칩니다."""
    job = get_job(run_id) or {}
    payload: dict = {
        "run_id": run_id,
        "status": job.get("status"),
        "n_models": job.get("n_models"),
        "n_items": job.get("n_items"),
        "n_rows": job.get("n_rows"),
        "message": job.get("message"),
    }
    try:
        with db.connect() as conn:
            run = db.fetch_run(conn, run_id)
    except Exception as exc:
        payload["message"] = payload.get("message") or f"DB 를 읽지 못했습니다: {exc}"
        return payload

    if not run:
        payload["status"] = payload.get("status") or "NOT_FOUND"
        payload["message"] = payload.get("message") or "해당 실행을 찾을 수 없습니다"
        return payload

    payload["status"] = job.get("status") or run.get("status")
    payload["run_status"] = run.get("status")
    payload["n_models"] = run.get("n_models")
    payload["n_items"] = run.get("n_items")
    payload["n_rows"] = run.get("n_rows")
    payload["message"] = job.get("message") or run.get("message")
    for key in ("started_at", "finished_at", "train_start", "train_end", "horizon"):
        value = run.get(key)
        payload[key] = value.isoformat() if isinstance(value, (datetime, date)) else value
    return payload
