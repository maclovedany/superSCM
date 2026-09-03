# STEP 8 구현 지시서 — Python Forecast Service

> 먼저 `docs/prompts/_공통규칙.md` 를 읽으세요. 이 단계는 대부분 Python 이지만, Next.js 쪽 연동 파일 몇 개도 만듭니다.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 8** 입니다. SQL Baseline 5종만 있는 예측 엔진에 **Python 모델(시계열 · 간헐수요 · ML)** 을 붙입니다.
별도 서비스(FastAPI)가 DB 의 학습 뷰를 읽어 예측하고, 결과를 **기존 SQL 실행과 같은 `run_id` 에 이어 붙입니다.**
그래야 STEP 7 의 백테스트가 SQL 모델과 Python 모델을 같은 조건에서 채점하고 Champion 을 뽑습니다.

읽을 PRD 장: **11(모델 후보 · Plug-in) · 12(Forecast Engine) · 33.1(예측 서비스) · 31.4(안정성)**.

## 구조 (확정)

```
forecast-service/                    ← 이 프로젝트 안의 별도 디렉터리. 별도 리포지토리로 떼어낼 수 있게 자기완결
  app/main.py                        FastAPI. 엔드포인트 4개
  app/db.py                          psycopg 접속 (DATABASE_URL). 읽기는 core.v_train_demand · core.forecast_setting · core.model_config 만
  app/pipeline.py                    run 이어 붙이기 · 예측구간 · 결과 write
  app/registry.py                    models/ 폴더를 훑어 MODEL_ID → forecast 함수 등록 (Plug-in)
  app/models/__init__.py
  app/models/ets.py                  ETS      단순 지수평활 (statsmodels)
  app/models/holt_winters.py         HOLT_WINTERS  가법 추세+계절 (statsmodels). 학습 기간이 2주기(24개월) 미만이면 빈 결과
  app/models/sarima.py               SARIMA   statsmodels SARIMAX. params 의 order/seasonal_order, 기본 (1,1,1)(0,1,1,12). 24개월 미만이면 비계절 ARIMA(1,1,1)
  app/models/croston.py              CROSTON · SBA · TSB  직접 구현 (한 파일에 세 함수, 각각 MODEL_ID 등록)
  app/models/lightgbm_model.py       LIGHTGBM 시차 feature(1·2·3·6·12) + 월 인덱스. import 실패 시 등록하지 않음
  app/models/prophet_model.py        PROPHET  import 가 되면 등록, 아니면 건너뜀 (requirements 에서 선택 설치)
  app/intervals.py                   in-sample 잔차 σ → p80 = 점추정 + 0.8416σ · p90 = + 1.2816σ (sql/11 과 같은 방식)
  tests/                             pytest. DB 없이 합성 시계열로 각 모델과 registry 를 검사
  requirements.txt                   fastapi · uvicorn · pydantic · psycopg[binary] · pandas · numpy · statsmodels · scikit-learn · lightgbm
  requirements-optional.txt          prophet
  Dockerfile · railway.toml · .env.example · README.md
```

**Plug-in 인터페이스** (renew.prd 11.2) — 모든 모델은 이 시그니처 하나만 구현합니다.

```python
def forecast(train_df: pd.DataFrame, horizon: int, params: dict) -> pd.DataFrame:
    # 입력  item_id · period(월초 date) · quantity      (한 품목의 학습 구간. 0 인 달도 포함된 격자)
    # 출력  period · predicted_qty · fit(선택: in-sample 적합값 시리즈, σ 계산용) · explanation(dict, 선택)
    # 값을 낼 수 없으면 빈 DataFrame 을 돌려준다. 0 이나 임의 값으로 채우지 않는다
```

`registry.py` 는 `app/models/*.py` 를 import 해 `MODEL_ID` (또는 `MODELS = {id: fn}`) 를 모읍니다. 새 모델 = 파일 하나 추가. 파이프라인 코드 수정 없음.

## 엔드포인트

```
GET  /health                         { ok, db: true|false, models: [...] }
GET  /models                         registry 목록 + core.model_config 의 enabled 여부
POST /forecast/run                   { run_id?: str, note?: str, models?: [str] }
                                     · run_id 가 있으면 그 run 에 이어 붙인다 (SQL Baseline 이 먼저 만든 run). 없으면 새 run 생성
                                     · core.model_config 에서 engine='PYTHON' and enabled 인 모델만 (models 로 더 좁힐 수 있음)
                                     · 즉시 { run_id, status:'RUNNING' } 반환, BackgroundTask 로 실행
GET  /forecast/run/{run_id}          { run_id, status, n_models, n_items, n_rows, message }
POST /backtest/run                   { forecast_run_id?: str }  → DB 함수 core.run_backtest(run_id) 호출 (아래 §DB 참조)
```

인증: `Authorization: Bearer <SERVICE_TOKEN>` (환경변수). `/health` 만 열어 둡니다.

## 파이프라인 규칙

- **학습 데이터는 `core.v_train_demand` 만 읽습니다.** `raw.usage_history` 문자열이 서비스 코드에 있으면 안 됩니다 (테스트로 grep 검사).
- 격자: `core.v_demand_grid` 를 읽어 0 인 달을 포함합니다.
- horizon · granularity 는 `core.forecast_setting` 에서. 예측 시작 = train_end 다음 달 (sql/11 과 동일).
- run 이어 붙이기: 기존 run 이면 `core.forecast_run.models` jsonb 에 Python 모델을 append 하고 `n_models` · `n_rows` 를 갱신. 새 run 이면 sql/11 과 같은 컬럼을 채워 insert (run_id 는 `run_py_YYYYMMDDHHMMSS_mmm`).
- 결과: `core.forecast_result(run_id, model_id, model_version, item_id, period, predicted_qty, p50, p80, p90, sigma, basis)` 에 insert. 같은 (run, model, item, period) 가 있으면 delete 후 insert (재실행 안전).
- 모델 버전: `core.model_version` 에 (model_id, version, definition) `on conflict do nothing`.
- `applicable_demand_type` 이 있으면 `analytics.v_sku_demand_profile.demand_type` 으로 품목을 거릅니다 (간헐 모델은 INTERMITTENT/LUMPY 에만). null 이면 전 품목.
- 한 모델·한 품목의 실패는 그 조합만 건너뛰고 `basis` 에 사유를 남깁니다. 서비스 전체가 죽지 않습니다.
- 실패한 run 은 `status='FAILED'` + message.

## DB 접속과 권한 — `sql/25-python-models.sql`

서비스는 `DATABASE_URL` 로 **직접 접속**합니다 (Supabase 의 Postgres 연결 문자열, `postgres` 사용자). RLS 는 테이블 소유자에게 적용되지 않으므로 별도 grant 가 필요 없습니다.

다만 `core.run_backtest()` 는 첫 줄에서 `core.is_admin()` 을 검사하고, 직접 접속에는 `auth.uid()` 가 없어 실패합니다. 아래를 `sql/25-python-models.sql` 에 넣습니다.

```sql
-- 직접 DB 접속(psql · 예측 서비스)은 관리자로 봅니다.
-- PostgREST 는 항상 'authenticator' 로 접속해 역할만 바꾸므로 session_user 가 authenticator 입니다.
-- 즉 API 를 통해 들어오는 요청에는 이 조건이 절대 참이 되지 않습니다.
create or replace function core.is_admin() returns boolean language sql stable security definer set search_path = core as $$
  select (auth.uid() is not null and exists (select 1 from core.app_user where user_id = auth.uid() and role = 'ADMIN' and active))
      or (auth.uid() is null and session_user not in ('authenticator', 'anon', 'authenticated'));
$$;
```

같은 파일에 PYTHON 모델을 등록합니다 (`on conflict (model_id) do nothing`):

| model_id | model_name | family | applicable_demand_type | parameters | enabled |
|---|---|---|---|---|---|
| ETS | 지수평활 | TIMESERIES | null | {"alpha": null} | true |
| HOLT_WINTERS | 홀트-윈터스 | TIMESERIES | ['SMOOTH','ERRATIC'] | {"seasonal_periods": 12, "damped": true} | true |
| SARIMA | SARIMA | TIMESERIES | ['SMOOTH','ERRATIC'] | {"order":[1,1,1],"seasonal_order":[0,1,1,12],"auto":true} | true |
| PROPHET | Prophet | TIMESERIES | ['SMOOTH','ERRATIC'] | {} | false |
| CROSTON | Croston | INTERMITTENT | ['INTERMITTENT','LUMPY'] | {"alpha": 0.1} | true |
| SBA | Croston-SBA | INTERMITTENT | ['INTERMITTENT','LUMPY'] | {"alpha": 0.1} | true |
| TSB | TSB | INTERMITTENT | ['INTERMITTENT','LUMPY'] | {"alpha_demand": 0.1, "alpha_prob": 0.1} | true |
| LIGHTGBM | LightGBM | ML | null | {"lags":[1,2,3,6,12],"n_estimators":200} | true |

`engine = 'PYTHON'`, `version = 'v1'`. 파일 끝: `select model_id, engine, enabled, applicable_demand_type from core.model_config order by engine, model_id;`

## Next.js 연동 (이 파일들만 손댑니다)

- `lib/forecast-service.ts` (신규) — `FORECAST_SERVICE_URL` · `FORECAST_SERVICE_TOKEN` 환경변수. `getServiceHealth()` · `runPythonForecast(runId, note)` · `getServiceRun(runId)`. 환경변수가 없으면 `{ configured: false }` 를 돌려주고 **절대 throw 하지 않습니다** (renew.prd 31.4: 서비스가 없어도 화면은 돈다).
- `app/(admin)/admin/forecast-runs/actions.ts` — SQL Baseline 실행 성공 후, 서비스가 configured 이고 PYTHON 모델이 하나라도 enabled 면 `runPythonForecast(run_id, note)` 를 호출해 이어 붙입니다. 실패해도 SQL 결과는 그대로 두고 메시지에 "Python 모델은 붙이지 못했습니다: <사유>" 를 덧붙입니다.
- `app/(admin)/admin/forecast-runs/page.tsx` — 헤더 meta 에 서비스 상태 칩 (`연결됨` / `미설정` / `응답 없음`).
- `app/(admin)/admin/models/page.tsx` — engine 이 PYTHON 인 행에 서비스 상태를 함께 표시 (미설정이면 "서비스 미설정 · 실행되지 않습니다" 문구).
- `.env.local.example` 에 `FORECAST_SERVICE_URL=` · `FORECAST_SERVICE_TOKEN=` 추가.
- **`lib/menu.ts` · `step.md` 는 건드리지 않습니다.** `app/(user)/**` 도 건드리지 않습니다 (다른 단계가 동시에 작업 중).

## 테스트 (pytest)

- Croston · SBA · TSB: 손으로 계산 가능한 짧은 간헐 시리즈로 첫 예측값 검증
- ETS · Holt-Winters · SARIMA: 합성 계절 시리즈(36개월)로 horizon 개 행이 나오고 값이 유한한지 · 12개월짜리에서 Holt-Winters 가 빈 결과를 내는지
- LightGBM: import 가 되는 환경에서만 (skip 마커)
- registry: 모든 모델이 `forecast(train_df, horizon, params)` 시그니처를 갖는지
- `raw.usage_history` 문자열이 `app/` 아래에 없는지

`python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pytest` 가 돌아야 합니다. `.venv` 는 `.gitignore` 에 추가합니다 (프로젝트 루트 `.gitignore` 에 `forecast-service/.venv/` 한 줄).

## 완료 판정

- [ ] `forecast-service/` 에서 pytest 통과 (출력 붙여넣기)
- [ ] `uvicorn app.main:app` 이 뜨고 `GET /health` 가 DB 없이도 `{ok: true, db: false}` 를 돌려준다
- [ ] `sql/25-python-models.sql` 작성
- [ ] Next.js: `npx tsc --noEmit` · `npm test` · `npm run build` 성공 (서비스 미설정 상태에서도)
- [ ] `grep -rn "usage_history" forecast-service/app` → 0건
- [ ] README 에 Railway 배포 · 환경변수 · 로컬 실행 · 새 모델 추가 방법(파일 하나)

## 보고서

`.superpowers/sdd/step/task-08-report.md` 에 `_공통규칙.md` §6 형식으로. 특히 "DB 실행 순서" 와 "서비스 배포 후 사용자가 확인할 것" 을 적습니다.
