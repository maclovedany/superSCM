-- 실습 데이터 6 · Forecast 실행 → Backtest → Champion 선정
--
-- ★ 결과 행을 직접 넣지 않습니다. 실제 실행 함수(core.run_baseline_forecast · core.run_backtest)를
--   그대로 부릅니다. 그래야
--     (1) Task 9b의 입력 지문(train_input_md5 · test_input_md5)이 SUCCESS 시점 트리거로 기록되고,
--     (2) 그 지문이 지금 데이터와 일치해 원천 게이트가 VERIFIED로 통과합니다.
--   결과를 손으로 넣으면 지문이 없어 FORECAST_INPUT_UNTRACED로 막힙니다.
--
-- ★ 두 함수 모두 실패해도 예외를 던지지 않고 run 행에 FAILED를 남깁니다(설계상). 그래서 여기서
--   상태를 직접 확인하고 실패면 메시지를 그대로 보여주며 멈춥니다 — 조용히 넘어가면 다음 단계에서
--   원인 모를 "Champion 없음"으로 나타납니다.
--
-- ⚠️ 적재와 Forecast 실행을 겹쳐 돌리지 마세요. 지문은 SUCCESS 시점에 찍히므로, 실행 도중에 커밋된
--    사용 이력이 지문에 섞일 수 있습니다(Task 9b fix1 판정).

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_run uuid;
  v_backtest uuid;
  v_status text;
  v_message text;
  v_champions integer;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- ── 순서 가드(fix round 1 · I2) ──────────────────────────────────
  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.', v_label;
  end if;
  if not exists (select 1 from core.forecast_setting where active) then
    raise exception '활성 학습/검증 기간이 없습니다. 04-usage-history.sql을 먼저 실행하세요.';
  end if;
  if not exists (select 1 from core.v_train_demand) then
    raise exception '학습 기간에 사용 이력이 한 행도 없습니다. 04-usage-history.sql의 확인 쿼리를 먼저 보세요.';
  end if;

  if exists (select 1 from core.practice_object where object_kind = 'FORECAST_RUN') then
    raise notice '실습 Forecast 실행이 이미 있습니다 — 건너뜁니다';
    return;
  end if;

  -- ── 1. SQL Baseline Forecast ─────────────────────────────────────
  v_run := core.run_baseline_forecast('[실습용 ' || v_label || '] SQL Baseline');
  select status, message into v_status, v_message from core.forecast_run where run_id = v_run;
  if v_status <> 'SUCCESS' then
    raise exception 'Forecast 실행이 실패했습니다(%): %', v_status, coalesce(v_message, '(메시지 없음)');
  end if;
  perform core.register_practice_object(v_label, 'FORECAST_RUN', v_run::text, 'SQL Baseline');

  -- ── 2. Backtest · Champion ───────────────────────────────────────
  v_backtest := core.run_backtest(v_run);
  select status, message into v_status, v_message from core.backtest_run where backtest_run_id = v_backtest;
  if v_status <> 'SUCCESS' then
    raise exception 'Backtest 실행이 실패했습니다(%): %', v_status, coalesce(v_message, '(메시지 없음)');
  end if;
  perform core.register_practice_object(v_label, 'BACKTEST_RUN', v_backtest::text, 'WAPE 기준 Champion 선정');

  select count(*) into v_champions
    from core.champion_model_selection
   where backtest_run_id = v_backtest and champion_model_id is not null;
  if v_champions = 0 then
    raise exception 'Champion이 한 품목도 선정되지 않았습니다 — 수요 유형이 SMOOTH/ERRATIC인지 확인하세요(04-usage-history.sql 확인 쿼리).';
  end if;

  raise notice 'Forecast % · Backtest % · Champion %품목', v_run, v_backtest, v_champions;
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────

-- ★ 가장 중요한 확인 — 원천 게이트가 VERIFIED여야 발주량이 계산됩니다.
select r.run_id, r.status, r.train_start, r.train_end,
       r.train_input_row_count, left(r.train_input_md5, 12) as train_md5,
       core.procurement_forecast_source_status(r.run_id) as source_status
  from core.forecast_run r
  join core.practice_object o on o.object_kind = 'FORECAST_RUN' and o.object_key = r.run_id::text;
-- 기대: status SUCCESS · train_input_md5 not null · source_status = 'VERIFIED'
--
-- VERIFIED가 아니면:
--   FORECAST_SOURCE_UNVERIFIED  학습·검증 기간에 출처 없는 행이 걸쳐 있습니다(04의 확인 쿼리 재실행)
--   FORECAST_INPUT_UNTRACED     이 마이그레이션 이전 실행입니다 — 다시 실행하세요
--   FORECAST_INPUT_CHANGED      실행 뒤 사용 이력이 바뀌었습니다 — 06을 다시 실행하세요
--   FORECAST_WINDOW_CHANGED     실행 뒤 학습·검증 기간 설정이 바뀌었습니다

select c.item_id, c.champion_model_id, round(c.wape, 4) as wape, round(c.bias, 2) as bias
  from analytics.v_champion_model c
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = c.item_id
 order by c.item_id;
-- 기대: 10행, champion_model_id not null

select count(*) as forecast_rows from core.forecast_result f
  join core.practice_object o on o.object_kind = 'FORECAST_RUN' and o.object_key = f.run_id::text;
-- 기대: 0보다 큼 (모델 수 × 품목 × 9개월)
