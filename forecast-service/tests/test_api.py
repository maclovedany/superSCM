"""엔드포인트 — DB 없이.

renew.prd 31.4 — "Python 예측 서버가 중단되어도 이미 저장된 예측 결과는 계속 조회된다."
그 반대편도 마찬가지입니다. **DB 가 없어도 /health 는 떠 있어야** 배포 상태를 볼 수 있습니다.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

TOKEN = "test-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
    return TestClient(app)


def test_health_works_without_a_database(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["db"] is False
    assert body["db_configured"] is False
    assert "CROSTON" in body["models"]


def test_health_needs_no_token(monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert TestClient(app).get("/health").status_code == 200


def test_protected_endpoints_require_a_bearer_token(client):
    assert client.get("/models").status_code == 401
    assert client.get("/models", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/forecast/run", json={}).status_code == 401
    assert client.post("/backtest/run", json={}).status_code == 401


def test_models_lists_the_registry_even_without_a_database(client):
    response = client.get("/models", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    body = response.json()
    assert "ETS" in body["models"]
    assert body["config"] == []
    assert body["db_error"]


def test_forecast_run_reports_missing_database_as_400(client):
    response = client.post(
        "/forecast/run", json={"note": "테스트"}, headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert response.status_code == 400
    assert "DATABASE_URL" in response.json()["detail"]


def test_everything_is_locked_when_no_service_token_is_set(monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    guarded = TestClient(app)
    response = guarded.get("/models", headers={"Authorization": "Bearer anything"})
    assert response.status_code == 401
    assert "SERVICE_TOKEN" in response.json()["detail"]


def test_health_does_not_leak_import_error_text(monkeypatch, client):
    """/health 는 인증 없이 열려 있습니다. 예외 원문에는 모듈 경로가 섞입니다."""
    monkeypatch.setattr(
        "app.registry.skipped",
        lambda: {"prophet_model": "ModuleNotFoundError: No module named 'prophet' at /srv/app/models"},
    )
    body = client.get("/health").json()
    assert body["skipped"] == {"prophet_model": "load failed"}


def test_models_still_shows_the_reason_behind_the_token(monkeypatch, client):
    monkeypatch.setattr("app.registry.skipped", lambda: {"prophet_model": "ModuleNotFoundError: ..."})
    body = client.get("/models", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert body["skipped"]["prophet_model"].startswith("ModuleNotFoundError")


def test_a_wrong_token_of_a_different_length_is_rejected(client):
    """compare_digest 는 길이가 달라도 예외 없이 False 를 돌려줘야 합니다."""
    assert client.get("/models", headers={"Authorization": "Bearer x"}).status_code == 401
    assert client.get("/models", headers={"Authorization": f"Bearer {TOKEN}x"}).status_code == 401
    assert client.get("/models", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
