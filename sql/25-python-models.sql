-- ──────────────────────────────────────────────────────────────
-- STEP 8 · Python Forecast Service — 모델 등록과 직접 접속 권한
--
-- renew.prd 11.1 · 11.3 · 33.1
--   "간헐수요 모델은 반드시 포함한다. 자재는 몇 달에 한 번 나가는 품목이 많고,
--    일반 시계열 모델은 이런 패턴에서 무너진다."
--   "Forecast Model 을 Frontend 에서 직접 실행하지 않는다.
--    별도 Forecast Service 또는 Batch Pipeline 으로 분리한다."
--
-- 여기서 하는 것
--   1. core.is_admin()  확장 — postgres 로의 직접 DB 접속(psql · 예측 서비스)을 관리자로 봅니다
--   2. core.v_data_snapshot — 데이터 기준 시각. 서비스가 raw 대신 이 뷰를 읽습니다
--   3. core.model_config 에 PYTHON 모델 8종 등록
--
-- ★ 테이블을 새로 만들지 않습니다. STEP 6 의 core.model_config 에 행만 넣습니다.
--   예측 결과는 SQL Baseline 과 **같은** core.forecast_run / core.forecast_result 에
--   같은 run_id 로 들어갑니다. 그래야 STEP 7 의 core.run_backtest 가
--   SQL 모델과 Python 모델을 같은 조건에서 채점합니다.
--
-- sql/13-backtest.sql 까지 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 직접 접속을 관리자로 ★ ══════════════════════════════════
--
-- 예측 서비스는 DATABASE_URL 로 Postgres 에 **직접** 접속합니다.
-- 이 경로에는 auth.uid() 가 없어서 core.run_baseline_forecast · core.run_backtest 의
-- 첫 줄 검사(core.is_admin())가 실패합니다.
--
-- PostgREST 는 항상 'authenticator' 로 접속한 뒤 set role 로 역할만 바꿉니다.
-- set role 은 current_user 만 바꾸고 session_user 는 그대로 둡니다.
-- 그래서 Data API 로 들어오는 모든 요청은 session_user 가 언제나 'authenticator' 입니다.
-- 즉 아래 두 번째 조건은 **API 경로에서 절대 참이 되지 않습니다.**
--
-- ★ session_user 를 씁니다. current_user 를 쓰면 이 함수가 security definer 라
--   함수 안의 current_user 가 항상 소유자가 되어 **모든 호출자가 관리자** 가 됩니다.
--
-- ★ 'postgres' 하나만 허용합니다 (allowlist). 넓게 열면 supabase_auth_admin ·
--   supabase_storage_admin · 운영자가 나중에 만들 임의의 역할까지 관리자로 봅니다.
--   **예측 서비스가 postgres 이외의 롤로 접속한다면 그 롤 이름을 아래 in (...) 목록에
--   추가하세요.** 배포에 쓸 DATABASE_URL 로 `select session_user;` 를 먼저 확인하십시오.
--   Supavisor(세션 모드) 경유여도 풀러가 테넌트 DB 사용자로 업스트림을 열기 때문에
--   보통 'postgres' 로 읽힙니다.
--
-- (기존 정의는 sql/03-auth.sql 에 있습니다. 여기서 조건을 하나 더합니다.)

create or replace function core.is_admin()
returns boolean
language sql
stable
security definer
set search_path = core
as $$
  select (auth.uid() is not null
          and exists (select 1 from core.app_user
                       where user_id = auth.uid() and role = 'ADMIN' and active))
      or (auth.uid() is null
          and session_user in ('postgres'));
$$;

comment on function core.is_admin() is
  'renew.prd 4.2 · 33.1 — 로그인 관리자, 또는 postgres 로의 직접 DB 접속(psql · 예측 서비스). PostgREST 는 session_user 가 언제나 authenticator 이므로 두 번째 조건에 걸리지 않습니다';

revoke all on function core.is_admin() from public, anon;
grant execute on function core.is_admin() to authenticated;

-- ══ 2. 데이터 기준 시각 ════════════════════════════════════════
--
-- renew.prd 8.6 — "이 시각 이후로 데이터가 바뀌면 예측이 stale 합니다."
-- sql/11 은 core.forecast_run.data_snapshot_at 에 raw.usage_history 의 max(loaded_at) 을
-- 넣고, analytics.v_forecast_run.is_stale 이 그 값을 다시 원본과 비교합니다.
--
-- 예측 서비스는 raw 를 읽지 않습니다 (학습 격리 · renew.prd 7.9). 그래서 core 뷰를 하나
-- 둡니다. **core 뷰가 raw 를 읽는 것은 이 프로젝트의 정상 경로입니다** (core.v_train_demand
-- 도 그렇습니다). 앱과 서비스는 core/analytics 만 읽습니다.
--
-- 이 뷰가 없으면 서비스가 now() 로 폴백합니다. 그 경우 서비스가 만든 run 은 무엇으로
-- 학습했든 다음 적재 전까지 항상 최신으로 읽힙니다.

create or replace view core.v_data_snapshot as
select max(loaded_at) as data_snapshot_at from core.realdata_load;

comment on view core.v_data_snapshot is
  'renew.prd 8.6 — 데이터 기준 시각. 예측 서비스가 raw 대신 이 뷰를 읽습니다';

grant select on core.v_data_snapshot to authenticated;
revoke all on core.v_data_snapshot from anon;

-- ══ 3. PYTHON 모델 등록 ════════════════════════════════════════
--
-- renew.prd 11.3 — applicable_demand_type 이 STEP 5 의 수요 분류와 맞물립니다.
--   null                          전 품목
--   ['SMOOTH','ERRATIC']          평활·불규칙 품목만 (시계열 모델)
--   ['INTERMITTENT','LUMPY']      간헐·덩어리 품목만 (Croston 계열)
--
-- 파라미터는 관리자 화면(/admin/models)에서 JSON 으로 바꿉니다. 코드 수정 없이
-- 다음 실행에 반영됩니다 (renew.prd 11.4).
--
-- PROPHET 만 enabled = false 입니다. 빌드가 무거워 선택 설치이기 때문입니다
-- (forecast-service/requirements-optional.txt). 설치한 뒤 여기서 켜세요.

insert into core.model_config
  (model_id, model_name, family, engine, version, enabled, is_default,
   applicable_demand_type, parameters, description)
values
  ('ETS', '지수평활', 'TIMESERIES', 'PYTHON', 'v1', true, false,
   null,
   '{"alpha": null}'::jsonb,
   '단순 지수평활. 최근값에 지수 가중을 줍니다. alpha 가 null 이면 자동 추정합니다'),

  ('HOLT_WINTERS', '홀트-윈터스', 'TIMESERIES', 'PYTHON', 'v1', true, false,
   array['SMOOTH','ERRATIC'],
   '{"seasonal_periods": 12, "damped": true}'::jsonb,
   '가법 추세 + 가법 계절. 학습 기간이 2주기(24개월) 미만이면 값을 내지 않습니다'),

  ('SARIMA', 'SARIMA', 'TIMESERIES', 'PYTHON', 'v1', true, false,
   array['SMOOTH','ERRATIC'],
   '{"order": [1,1,1], "seasonal_order": [0,1,1,12], "auto": true}'::jsonb,
   '계절 ARIMA. 24개월 미만이면 비계절 ARIMA(1,1,1) 로 내려갑니다. auto 면 적합 실패 시 더 단순한 차수로 물러섭니다'),

  ('PROPHET', 'Prophet', 'TIMESERIES', 'PYTHON', 'v1', false, false,
   array['SMOOTH','ERRATIC'],
   '{}'::jsonb,
   '계절성·이벤트. 예측 서비스에 선택 설치입니다. 설치한 뒤 여기서 켜세요'),

  ('CROSTON', 'Croston', 'INTERMITTENT', 'PYTHON', 'v1', true, false,
   array['INTERMITTENT','LUMPY'],
   '{"alpha": 0.1}'::jsonb,
   '수요를 크기와 발생 간격으로 나눠 각각 지수평활합니다. 간헐수요의 기준 모델입니다'),

  ('SBA', 'Croston-SBA', 'INTERMITTENT', 'PYTHON', 'v1', true, false,
   array['INTERMITTENT','LUMPY'],
   '{"alpha": 0.1}'::jsonb,
   'Croston 은 구조적으로 과대예측합니다. (1 - alpha/2) 로 편향을 보정합니다'),

  ('TSB', 'TSB', 'INTERMITTENT', 'PYTHON', 'v1', true, false,
   array['INTERMITTENT','LUMPY'],
   '{"alpha_demand": 0.1, "alpha_prob": 0.1}'::jsonb,
   '크기와 수요 발생 확률을 평활합니다. 확률은 수요가 없는 달에도 갱신되므로 단종 품목을 빨리 반영합니다'),

  ('LIGHTGBM', 'LightGBM', 'ML', 'PYTHON', 'v1', true, false,
   null,
   '{"lags": [1,2,3,6,12], "n_estimators": 200}'::jsonb,
   '시차 수요와 월 인덱스로 학습합니다. 데이터가 짧으면 과적합할 수 있으나 판정은 백테스트가 합니다')
on conflict (model_id) do nothing;

-- ══ 4. 확인 ════════════════════════════════════════════════════
--
-- 실행 뒤 이 select 로 PYTHON 8종이 들어왔는지 봅니다.
-- (기본값대로면 SQL 5종 + PYTHON 8종 = 13행, 그 중 enabled 12종)

select model_id, engine, enabled, applicable_demand_type
  from core.model_config
 order by engine, model_id;

-- 데이터 기준 시각이 나오는지:
--   select * from core.v_data_snapshot;
--
-- 직접 접속에서 관리자로 보이는지 확인 (SQL Editor · psql 에서 t 가 나와야 합니다):
--   select core.is_admin(), session_user, auth.uid();
--
-- ★ 배포에 쓸 DATABASE_URL 로도 같은 select 를 돌려보세요.
--   session_user 가 'postgres' 가 아니면 위 함수의 in (...) 목록에 그 이름을 추가해야
--   예측 서비스가 core.run_backtest 를 부를 수 있습니다.
--
-- ★ 로그인한 앱에서도 확인하세요 (관리자 화면 /admin/models 가 열리고 저장되면 정상).
--   앱 세션에서 session_user 가 'postgres' 로 나온다면 이 조건을 쓰면 안 됩니다.
--
-- 예측 서비스를 붙인 뒤 전체 흐름:
--   1) 관리자 화면 /admin/forecast-runs 에서 "예측 실행"
--      → core.run_baseline_forecast() 가 SQL 5종을 넣고 run_id 를 만듭니다
--      → 이어서 Next.js 가 POST /forecast/run {run_id} 로 Python 모델을 붙입니다
--   2) select model_id, count(*) from core.forecast_result
--       where run_id = '<run_id>' group by model_id order by model_id;
--      → SQL 5종 + PYTHON 모델이 함께 나와야 합니다
--   3) select * from core.run_backtest('<run_id>');
--      → 두 계열을 같은 조건에서 채점하고 Champion 을 뽑습니다
