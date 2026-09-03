"""학습 격리 — 서비스 코드가 raw 원본 테이블을 읽지 않는지 (renew.prd 7.9 · 12.1).

`core.v_train_demand` / `core.v_demand_grid` 는 forecast_setting.train_end 이후 행을
내보내지 않습니다. 원본 테이블을 직접 읽으면 그 경계가 무너집니다 (Data Leakage).

검증 구간 정답지인 `core.v_test_actual` 도 이 서비스에서 읽지 않습니다.
채점은 DB 함수 core.run_backtest 안에서만 일어납니다.
"""

from __future__ import annotations

from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

# 서비스 코드에 있으면 안 되는 문자열
FORBIDDEN = [
    "usage_history",
    "raw.item_master",
    "raw.stock",
    "raw.shipment_log",
    "raw.sales_order",
    "v_test_actual",
]

ALLOWED_SOURCES = [
    "core.forecast_setting",
    "core.model_config",
    "core.v_demand_grid",
    "core.v_data_snapshot",
    "core.v_train_demand",
    "core.forecast_run",
    "core.forecast_result",
    "core.model_version",
    "analytics.v_sku_demand_profile",
]


def python_files() -> list[Path]:
    return sorted(APP_DIR.rglob("*.py"))


def test_service_never_mentions_raw_tables():
    offenders = []
    for path in python_files():
        text = path.read_text(encoding="utf-8")
        for needle in FORBIDDEN:
            if needle in text:
                offenders.append(f"{path.relative_to(APP_DIR.parent)} → {needle}")
    assert offenders == [], "학습 격리를 깨는 참조: " + ", ".join(offenders)


def test_db_module_only_reads_the_allowed_sources():
    text = (APP_DIR / "db.py").read_text(encoding="utf-8")
    for source in ALLOWED_SOURCES:
        assert source in text, f"{source} 를 db.py 가 다루지 않습니다"


def test_there_is_at_least_one_python_file_to_scan():
    assert len(python_files()) >= 8
