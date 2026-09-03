"""모델 레지스트리 — Plug-in (renew.prd 11.2).

`app/models/*.py` 를 훑어 모델을 모읍니다.

    MODEL_ID = 'ETS'                 + def forecast(...)   → 모델 하나
    MODELS = {'CROSTON': fn, ...}                          → 파일 하나에 여러 모델

**새 모델을 추가하는 방법은 파일 하나를 넣는 것뿐입니다.** 파이프라인 코드는 고치지 않습니다.

import 에 실패한 모듈(예: lightgbm · prophet 미설치)은 **건너뜁니다.**
건너뛴 사유는 `skipped()` 로 확인할 수 있고 `/health` · `/models` 에 나옵니다.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
from typing import Callable

from . import models as models_pkg

log = logging.getLogger(__name__)

# forecast(train_df, horizon, params) 시그니처의 필수 인자 이름
REQUIRED_ARGS = ("train_df", "horizon", "params")

_registry: dict[str, Callable] | None = None
_skipped: dict[str, str] = {}


def _valid_signature(fn: Callable) -> bool:
    if not callable(fn):
        return False
    try:
        names = list(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        return False
    return names[: len(REQUIRED_ARGS)] == list(REQUIRED_ARGS)


def _discover() -> tuple[dict[str, Callable], dict[str, str]]:
    found: dict[str, Callable] = {}
    skipped: dict[str, str] = {}

    for info in pkgutil.iter_modules(models_pkg.__path__):
        name = info.name
        if name.startswith("_"):
            continue
        try:
            module = importlib.import_module(f"{models_pkg.__name__}.{name}")
        except Exception as exc:  # 선택 의존성 미설치 등 — 조용히 건너뜁니다
            skipped[name] = f"{type(exc).__name__}: {exc}"
            log.info("모델 모듈 %s 을(를) 건너뜁니다: %s", name, exc)
            continue

        table = getattr(module, "MODELS", None)
        if isinstance(table, dict):
            for model_id, fn in table.items():
                if _valid_signature(fn):
                    found[str(model_id)] = fn
                else:
                    skipped[str(model_id)] = "forecast(train_df, horizon, params) 시그니처가 아닙니다"
            continue

        model_id = getattr(module, "MODEL_ID", None)
        fn = getattr(module, "forecast", None)
        if model_id and fn is not None:
            if _valid_signature(fn):
                found[str(model_id)] = fn
            else:
                skipped[str(model_id)] = "forecast(train_df, horizon, params) 시그니처가 아닙니다"

    return found, skipped


def load(reload: bool = False) -> dict[str, Callable]:
    """MODEL_ID → forecast 함수. 처음 한 번만 훑고 캐시합니다."""
    global _registry, _skipped
    if _registry is None or reload:
        _registry, _skipped = _discover()
    return _registry


def skipped() -> dict[str, str]:
    """등록하지 못한 모듈과 사유."""
    load()
    return dict(_skipped)


def model_ids() -> list[str]:
    return sorted(load().keys())


def get(model_id: str) -> Callable | None:
    return load().get(model_id)


def has(model_id: str) -> bool:
    return model_id in load()
