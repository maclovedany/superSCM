"""FastAPI — SuperSCM Python Forecast Service (renew.prd 33.1).

엔드포인트
    GET  /health                    인증 없음. DB 가 없어도 200
    GET  /models                    registry + core.model_config
    POST /forecast/run              run 이어 붙이기. 즉시 RUNNING 반환 후 BackgroundTask
    GET  /forecast/run/{run_id}     진행 상황
    POST /backtest/run              core.run_backtest 호출

인증
    Authorization: Bearer <SERVICE_TOKEN>
    SERVICE_TOKEN 이 설정되지 않으면 /health 를 뺀 모든 엔드포인트가 401 입니다 (fail-closed).
"""

from __future__ import annotations

import logging
import os
import secrets

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import __version__, db, pipeline, registry

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger(__name__)

app = FastAPI(
    title="SuperSCM Forecast Service",
    version=__version__,
    description="SQL Baseline 이 만든 예측 실행에 Python 모델 결과를 이어 붙입니다.",
)


# ── 인증 ──────────────────────────────────────────────────────


def service_token() -> str | None:
    token = os.getenv("SERVICE_TOKEN")
    return token.strip() if token and token.strip() else None


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = service_token()
    if not expected:
        raise HTTPException(status_code=401, detail="SERVICE_TOKEN 이 설정되지 않았습니다")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authorization 헤더가 필요합니다")
    # 상수 시간 비교. != 는 앞자리부터 어긋나는 지점이 응답 시간에 드러납니다.
    if not secrets.compare_digest(authorization.split(" ", 1)[1].strip(), expected):
        raise HTTPException(status_code=401, detail="토큰이 올바르지 않습니다")


# ── 요청 본문 ─────────────────────────────────────────────────


class ForecastRunRequest(BaseModel):
    run_id: str | None = Field(default=None, description="이어 붙일 기존 run. 없으면 새 run 을 만듭니다")
    note: str | None = Field(default=None, description="실행 메모")
    models: list[str] | None = Field(default=None, description="이 모델만 실행합니다")


class PipelineRunRequest(BaseModel):
    mode: str = Field(default="VALIDATION", description="VALIDATION 또는 PRODUCTION")
    note: str | None = Field(default=None, description="실행 메모")
    models: list[str] | None = Field(default=None, description="이 Python 모델만 실행합니다")


class BacktestRunRequest(BaseModel):
    forecast_run_id: str | None = Field(default=None, description="채점할 예측 실행. 없으면 최근 성공 run")
    note: str | None = None


# ── 엔드포인트 ────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    """DB 가 없어도 200 을 돌려줍니다 (renew.prd 31.4).

    인증 없이 열려 있으므로 예외 원문(모듈 경로가 섞입니다)을 내보내지 않습니다.
    건너뛴 모듈의 사유는 인증이 필요한 /models 에서 봅니다.
    """
    return {
        "ok": True,
        "db": db.ping(),
        "db_configured": db.is_configured(),
        "models": registry.model_ids(),
        "skipped": {name: "load failed" for name in registry.skipped()},
        "version": __version__,
    }


@app.get("/models", dependencies=[Depends(require_token)])
def models() -> dict:
    available = registry.model_ids()
    configured: list[dict] = []
    db_error: str | None = None

    try:
        with db.connect() as conn:
            rows = db.fetch_all_models(conn)
        for row in rows:
            configured.append(
                {
                    "model_id": row["model_id"],
                    "model_name": row["model_name"],
                    "family": row["family"],
                    "engine": row["engine"],
                    "version": row["version"],
                    "enabled": row["enabled"],
                    "applicable_demand_type": row["applicable_demand_type"],
                    "parameters": row["parameters"],
                    # PYTHON 모델인데 서비스에 없으면 실행되지 않습니다.
                    "available_in_service": row["model_id"] in available
                    if row["engine"] == "PYTHON"
                    else None,
                }
            )
    except Exception as exc:
        db_error = str(exc)

    return {
        "models": available,
        "skipped": registry.skipped(),
        "config": configured,
        "db_error": db_error,
    }


@app.post("/forecast/run", dependencies=[Depends(require_token)])
def forecast_run(body: ForecastRunRequest, background: BackgroundTasks) -> dict:
    try:
        prepared = pipeline.prepare(body.run_id, body.note, body.models)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pipeline.set_job(
        prepared["run_id"],
        status="RUNNING",
        message="대기 중입니다",
        n_models=len(prepared["models"]),
    )
    background.add_task(
        pipeline.execute,
        prepared["run_id"],
        prepared["created"],
        body.models,
    )
    return {
        "run_id": prepared["run_id"],
        "status": "RUNNING",
        "created": prepared["created"],
        "models": prepared["models"],
        "horizon": prepared["horizon"],
    }


@app.post("/pipeline/run", dependencies=[Depends(require_token)])
def pipeline_run(body: PipelineRunRequest, background: BackgroundTasks) -> dict:
    """전체 파이프라인 — SQL 기준 모델 → Python 모델 → 실체화 → (검증이면) 백테스트.

    PostgREST RPC 의 문장 시간 제한을 피해 서비스가 직접 접속으로 전부 부릅니다.
    즉시 pipeline id 를 돌려주고 GET /forecast/run/{id} 로 진행 상황을 봅니다.
    """
    mode = body.mode.strip().upper()
    if mode not in ("VALIDATION", "PRODUCTION"):
        raise HTTPException(status_code=400, detail="mode 는 VALIDATION 또는 PRODUCTION 이어야 합니다")
    if not db.is_configured():
        raise HTTPException(status_code=400, detail="DATABASE_URL 이 설정되지 않았습니다")
    # ★ 한 번에 하나. 버튼을 여러 번 누르면 같은 DB 에서 실행 여러 개가 겹쳐 전부 느려지고 결과도 여럿 생깁니다.
    running = pipeline.running_pipeline()
    if running is not None:
        raise HTTPException(
            status_code=409,
            detail=f"이미 실행 중인 파이프라인이 있습니다 ({running['run_id']} · {running.get('stage')}). 끝난 뒤 다시 누르세요.",
        )
    job_id = pipeline.new_pipeline_id()
    pipeline.set_job(job_id, status="RUNNING", mode=mode, stage="QUEUED", message="대기 중입니다")
    background.add_task(pipeline.run_full, job_id, mode, body.note, body.models)
    return {"pipeline_id": job_id, "status": "RUNNING", "mode": mode}


@app.get("/pipeline/running", dependencies=[Depends(require_token)])
def pipeline_running() -> dict:
    """지금 돌고 있는 파이프라인. 관리자 화면이 새로 열려도 "실행 중" 을 이어서 보이게 합니다."""
    job = pipeline.running_pipeline()
    return {"running": job is not None, "pipeline_id": job.get("run_id") if job else None,
            "stage": job.get("stage") if job else None, "message": job.get("message") if job else None}


@app.get("/forecast/run/{run_id}", dependencies=[Depends(require_token)])
def forecast_run_status(run_id: str) -> dict:
    return pipeline.run_status(run_id)


@app.post("/backtest/run", dependencies=[Depends(require_token)])
def backtest_run(body: BacktestRunRequest) -> dict:
    try:
        return pipeline.run_backtest(body.forecast_run_id, body.note)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
