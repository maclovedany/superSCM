# SuperSCM · Python Forecast Service

SQL Baseline 이 만든 예측 실행(`run_id`)에 **Python 모델 결과를 이어 붙이는** 서비스입니다.
같은 run 안에 SQL 모델과 Python 모델이 함께 있어야 STEP 7 의 백테스트가 **같은 학습 구간 ·
같은 검증 구간 · 같은 스냅샷** 으로 채점하고 Champion 을 뽑습니다 (renew.prd 13 · 14).

이 디렉터리는 자기완결입니다. 별도 저장소로 떼어내도 그대로 돕니다.

```
Next.js (Vercel)                       Forecast Service (Railway)
  관리자 · 예측 실행                        FastAPI
        │                                     │
        │ 1. rpc core.run_baseline_forecast   │
        ▼                                     │
   Supabase Postgres ◄── 3. 같은 run_id 에 append ──┘
        │                                     ▲
        └── 2. POST /forecast/run {run_id} ───┘
```

---

## 모델

| model_id | 계열 | 구현 | 비고 |
|---|---|---|---|
| `ETS` | 시계열 | statsmodels SimpleExpSmoothing | `alpha` 가 null 이면 자동 추정 |
| `HOLT_WINTERS` | 시계열 | statsmodels ExponentialSmoothing | 가법 추세+계절. **2주기(24개월) 미만이면 빈 결과** |
| `SARIMA` | 시계열 | statsmodels SARIMAX | 24개월 미만이면 비계절 ARIMA. `auto` 면 실패 시 더 단순한 차수로 물러섬 |
| `PROPHET` | 시계열 | prophet | **선택 설치.** 없으면 등록되지 않음 |
| `CROSTON` | 간헐수요 | 직접 구현 | 크기 `z` · 간격 `p` 를 지수평활 → `z/p` |
| `SBA` | 간헐수요 | 직접 구현 | Croston × `(1 − α/2)` 편향 보정 |
| `TSB` | 간헐수요 | 직접 구현 | 크기 × 발생확률. 수요가 없는 달에도 확률을 갱신 |
| `LIGHTGBM` | ML | lightgbm | 시차 1·2·3·6·12 + 월 인덱스, 재귀 다단계. σ 는 out-of-fold 잔차 |

값을 낼 수 없으면 **행을 만들지 않습니다.** 0 이나 임의 값으로 채우지 않습니다
(AGENTS.md 규칙 5 · renew.prd 31.5). 사유는 run 의 `models` jsonb 안 `skipped` 에 남습니다.

---

## 로컬 실행

```bash
cd forecast-service
python3.12 -m venv .venv                      # 3.11 · 3.12 · 3.13 모두 됩니다
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest                              # DB 없이 돕니다

cp .env.example .env                          # DATABASE_URL · SERVICE_TOKEN 을 채웁니다
set -a && . ./.env && set +a
.venv/bin/uvicorn app.main:app --reload --port 8000
```

`GET /health` 는 **DB 가 없어도 200** 입니다. 배포 상태를 먼저 볼 수 있어야 하기 때문입니다.

```bash
curl localhost:8000/health
# {"ok":true,"db":false,"db_configured":false,"models":["CROSTON","ETS", ...]}
```

### macOS 에서 LightGBM 이 로드되지 않을 때

`Library not loaded: @rpath/libomp.dylib` 이 나오면 OpenMP 런타임이 없는 것입니다.

```bash
brew install libomp
```

설치하지 않아도 서비스는 뜹니다. `LIGHTGBM` 만 registry 에 등록되지 않고 `/health` 의
`skipped` 에 사유가 나옵니다.

### Prophet (선택)

```bash
.venv/bin/pip install -r requirements-optional.txt
```

설치하지 않으면 `PROPHET` 은 등록되지 않고 `core.model_config` 에서도 `enabled = false` 입니다.

---

## 엔드포인트

인증은 `Authorization: Bearer <SERVICE_TOKEN>` 입니다. `/health` 만 열려 있습니다.
`SERVICE_TOKEN` 이 설정되지 않으면 나머지는 전부 401 입니다 (fail-closed).

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/health` | `{ ok, db, db_configured, models, skipped, version }` |
| `GET` | `/models` | registry 목록 + `core.model_config` 의 enabled 여부 |
| `POST` | `/forecast/run` | `{ run_id?, note?, models? }` → 즉시 `{ run_id, status:'RUNNING' }`. 실행은 BackgroundTask |
| `GET` | `/forecast/run/{run_id}` | `{ run_id, status, n_models, n_items, n_rows, message }` |
| `POST` | `/backtest/run` | `{ forecast_run_id? }` → DB 함수 `core.run_backtest` 호출 |

```bash
TOKEN=change-me

# SQL Baseline 이 만든 run 에 Python 모델을 이어 붙입니다
curl -X POST localhost:8000/forecast/run \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"run_id":"run_20250901120000_123","note":"Python 모델 추가"}'

curl localhost:8000/forecast/run/run_20250901120000_123 -H "Authorization: Bearer $TOKEN"

# 같은 run 을 SQL·Python 모델 전부로 채점합니다
curl -X POST localhost:8000/backtest/run \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"forecast_run_id":"run_20250901120000_123"}'
```

`run_id` 를 주지 않으면 새 run 을 만듭니다 (`run_py_YYYYMMDDHHMMSS_mmm`). 이 경우 SQL
모델 결과가 없으므로 백테스트가 Python 모델끼리만 비교합니다.

---

## 새 모델 추가 — 파일 하나

`app/models/` 에 파일 하나를 넣으면 끝입니다. **파이프라인 코드는 고치지 않습니다**
(renew.prd 11.2 Plug-in Architecture).

```python
# app/models/theta.py
import numpy as np
from . import empty_result, future_periods, make_result, quantities

MODEL_ID = "THETA"

def forecast(train_df, horizon: int, params: dict | None = None):
    y = quantities(train_df)                      # 기간 오름차순 float 배열
    if len(y) < 6:
        return empty_result("학습 기간이 6개월 미만입니다")

    periods = future_periods(train_df, horizon)   # train_end 다음 달부터 horizon 개
    point = np.full(horizon, float(np.mean(y[-6:])))

    return make_result(
        periods,
        point,
        fit=None,                                 # in-sample 적합값 (있으면 σ → p80·p90)
        explanation={"method": "theta", "n_train": len(y)},
    )
```

파일 하나에 모델 여러 개를 넣으려면 `MODELS = {"A": fn_a, "B": fn_b}` 를 노출합니다
(`app/models/croston.py` 가 그렇게 합니다).

그 다음 `core.model_config` 에 한 줄을 넣습니다 (`sql/25-python-models.sql` 참고).

```sql
insert into core.model_config
  (model_id, model_name, family, engine, version, enabled, applicable_demand_type, parameters)
values ('THETA', 'Theta', 'TIMESERIES', 'PYTHON', 'v1', true, null, '{}'::jsonb)
on conflict (model_id) do nothing;
```

`import` 에 실패하는 모듈(선택 의존성 미설치 등)은 **조용히 건너뜁니다.** 사유는
`/health` 의 `skipped` 에 나옵니다.

### 규칙

- 값을 낼 수 없으면 `empty_result(사유)`. 0 이나 임의 값으로 채우지 않습니다.
- 학습 데이터는 인자로 받은 `train_df` 뿐입니다. DB 를 직접 읽지 않습니다.
- 예측값은 음수가 될 수 없습니다 (`np.clip(point, 0, None)`).
- 난수를 쓴다면 시드를 고정합니다 (renew.prd 31.3 재현성).
- `fit` 은 **학습에 쓰지 않은** 한 걸음 앞 예측이어야 합니다. 학습셋을 그대로 예측한 값을
  넘기면 σ 가 0 으로 붕괴하고 `p80`·`p90` 이 점추정에 붙습니다. 잴 수 없는 자리는 `nan` 으로
  두세요 (`app/models/lightgbm_model.py` 의 `_out_of_fold_fit` 참고).

---

## 데이터 격리 ★

이 서비스는 **`core.v_demand_grid` · `core.v_train_demand` 만** 학습 데이터로 읽습니다.
두 뷰는 `core.forecast_setting.train_end` 이후 행을 물리적으로 내보내지 않습니다
(renew.prd 7.9 · 12.1).

원본 테이블과 검증 정답지(`core.v_test_actual`)는 이 서비스가 읽지 않습니다.
채점은 DB 함수 `core.run_backtest` 안에서만 일어납니다.
`tests/test_no_raw_access.py` 가 `app/` 전체를 훑어 이 규칙을 강제합니다.

읽고 쓰는 대상 전부:

```
읽기  core.forecast_setting · core.model_config · core.v_demand_grid ·
      core.v_train_demand · core.v_data_snapshot · core.forecast_run ·
      analytics.v_sku_demand_profile
쓰기  core.forecast_run · core.forecast_result · core.model_version
호출  core.run_backtest(text, text)
```

---

## DB 준비

`sql/25-python-models.sql` 을 Supabase SQL Editor 에서 실행하세요. 세 가지를 합니다.

1. `core.is_admin()` 확장 — **`postgres` 로의** 직접 DB 접속(psql · 이 서비스)을 관리자로
   봅니다. PostgREST 는 항상 `authenticator` 로 접속해 역할만 바꾸므로 **API 경로에는 이
   조건이 절대 참이 되지 않습니다.**
2. `core.v_data_snapshot` — 데이터 기준 시각. 이 서비스는 raw 를 읽지 않으므로 이 뷰를 봅니다.
3. PYTHON 모델 8종을 `core.model_config` 에 등록

1번이 없으면 `POST /backtest/run` 이 `관리자 권한이 필요합니다` 로 실패합니다.

**`DATABASE_URL` 은 `postgres` 사용자로 접속해야 합니다.** 직접 접속
(`db.<ref>.supabase.co:5432`) 이든 Supavisor **세션 모드** 든 상관없지만, 다른 롤로 붙으면
백테스트 호출이 막힙니다. 배포 전에 그 URL 로 아래를 돌려 확인하세요.

```sql
select core.is_admin(), session_user;
-- 기대: t · postgres
```

`postgres` 가 아닌 값이 나오면 `sql/25-python-models.sql` 의 `session_user in ('postgres')`
목록에 그 롤 이름을 추가하세요. 조건을 `not in (...)` 형태로 되돌리지 마세요.

---

## Railway 배포

1. Railway → New Project → Deploy from GitHub repo
2. Root Directory 를 `forecast-service` 로 지정 (모노레포이므로 반드시 필요합니다)
3. Variables

   | 이름 | 값 |
   |---|---|
   | `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI). **`postgres` 사용자** — 직접 접속 또는 Supavisor 세션 모드 |
   | `SERVICE_TOKEN` | 임의의 긴 문자열. Next.js 의 `FORECAST_SERVICE_TOKEN` 과 같게 |
   | `LOG_LEVEL` | `INFO` |
   | `DB_PING_TTL` | `45` (선택). `/health` 의 DB 확인 결과를 재사용할 초 |

4. `railway.toml` 이 Dockerfile 빌드와 `/health` 헬스체크를 지정합니다
5. 배포 후 `curl https://<앱>.up.railway.app/health` 로 `{"ok":true,"db":true}` 확인
6. Vercel(Next.js) 에 `FORECAST_SERVICE_URL` · `FORECAST_SERVICE_TOKEN` 을 넣고 재배포

Supabase 는 IPv6 direct connection 을 씁니다. Railway 에서 접속이 안 되면
**Connection Pooler (Session mode, 포트 5432)** 문자열로 바꾸세요. 세션 모드여야 합니다 —
트랜잭션 모드는 풀러가 연결을 재사용해 `session_user` 판정과 트랜잭션 경계가 흔들립니다.

서비스가 없어도 Next.js 화면은 그대로 돕니다. `FORECAST_SERVICE_URL` 이 없으면
관리자 화면에 `미설정` 칩이 뜨고 SQL 모델만 실행됩니다 (renew.prd 31.4).

---

## 파일

```
app/main.py              FastAPI. 엔드포인트 5개 + Bearer 인증
app/db.py                psycopg 접속. 읽고 쓰는 대상이 여기 전부 모여 있습니다
app/pipeline.py          run 이어 붙이기 · 예측 · 결과 write · 실패 격리
app/registry.py          app/models/*.py 를 훑어 MODEL_ID → forecast 등록 (Plug-in)
app/intervals.py         잔차 σ → p80 = 점추정 + 0.8416σ · p90 = + 1.2816σ (sql/11 과 동일)
app/models/__init__.py   플러그인 공통 도구 (make_result · empty_result · future_periods)
app/models/*.py          모델 하나(또는 여럿)당 파일 하나
tests/                   pytest. DB 없이 합성 시계열로 검사
```

---

## 전체 파이프라인 — `POST /pipeline/run` (실데이터 전환 Plan 2)

관리자 화면의 "예측 실행" 은 서비스가 살아 있으면 이 엔드포인트를 부릅니다. 서비스가 **직접 접속**으로
아래를 순서대로 돌리므로 PostgREST RPC 의 문장 시간 제한(30초)에 걸리지 않습니다.

```
POST /pipeline/run  {"mode": "VALIDATION" | "PRODUCTION", "note": "...", "models": ["ETS", ...]?}
  ① core.run_baseline_forecast(note, mode)      SQL 기준 모델 5종
  ② Python 모델 — 그 run 에 이어 붙임 (모드에 맞는 격자: 운영은 production_train_end 까지)
  ③ core.refresh_forecast_current() · core.build_dependent_demand()   화면이 쓰는 표
  ④ VALIDATION 이면 core.run_backtest(run_id)   Champion 선정
→ {"pipeline_id": "pipe_…", "status": "RUNNING"}
GET /forecast/run/{pipeline_id 또는 run_id}   → status · stage(SQL/PYTHON/MATERIALIZE/BACKTEST/DONE) · progress
```

### 시간 예산 — `PIPELINE_MODEL_BUDGET_SECONDS` (기본 300)

품목 11,000개에서 LightGBM 은 품목당 2초, 전체 5시간이 걸립니다(실측). 모델마다 시간 예산을 두고,
**학습 총량이 큰 품목부터** 돌리다 예산을 넘기면 남은 품목은 `TIME_BUDGET` 사유로 건너뜁니다 — 값을 지어내지 않습니다.
건너뛴 수는 run 의 `models` jsonb 에 `n_time_budget` 으로 남습니다. 모델별로 `core.model_config.parameters.time_budget_s`
로 바꿀 수 있고, 0 이면 무제한입니다.

### Docker 없이 로컬에서

```bash
cd forecast-service
DATABASE_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres' \
SERVICE_TOKEN='<앱의 FORECAST_SERVICE_TOKEN 과 같은 값>' \
.venv/bin/uvicorn app.main:app --port 8000
```

Docker 를 쓰면 `docker build -t superscm-forecast . && docker run -p 8000:8000 -e DATABASE_URL=… -e SERVICE_TOKEN=… superscm-forecast`.
