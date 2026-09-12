-- 실습 데이터 4 · 12개월 사용 이력과 학습/검증 기간
--
-- ★★ 이 파일이 Forecast 원천 게이트(Task 9b)와 정면으로 만나는 지점입니다. 게이트는 학습·검증
--    기간의 사용 이력이 **전부** IMPORTED 상태의 usage_history 적재 배치에서 왔고 source_type이
--    FILE_UPLOAD일 때만 발주량을 계산합니다. 게이트를 완화하지 않고 조건을 진짜로 만족시킵니다.
--
--    문제: 배포 DB에는 5회차 더미 사용 이력 7,038행이 batch_id = null로 남아 있습니다. 학습 기간에
--    그 행이 한 줄이라도 걸치면 게이트가 (정상적으로) 막습니다.
--    해결: 학습 기간을 **기존 미검증 행의 마지막 날짜 다음 달부터** 잡습니다. 날짜를 하드코딩하지
--    않고 실행 시점에 계산하며, 고른 기간을 notice로 출력합니다.
--
--    ⚠️ 그래서 실습 기간이 실제 달력보다 미래일 수 있습니다(더미 데이터가 어디까지 있는지에 따라).
--    이상해 보여도 정상입니다 — 게이트를 우회하는 것보다 기간이 미래인 편이 낫습니다.
--
-- 기간 구성 (M1이 첫 달)
--   M1 ~ M9    학습(train)      — Forecast가 배우는 구간
--   M10 ~ M12  검증(test)       — Backtest가 채점하는 구간
--   M13        기준월(plan)     — 발주계획 1개월차. forecast_horizon 9면 M10~M18까지 예측하므로
--                                 M13~M18(6개월) 계획이 전부 채워집니다(Task 9b 전제조건).
--
-- 수요 모양 — 품목마다 다른 기준량에 계절성(사인)과 완만한 증가 추세를 줍니다. 0인 달이 없어야
-- 수요 유형이 SMOOTH/ERRATIC으로 분류되고, 그래야 STEP 6의 SQL Baseline 모델이 적용됩니다
-- (INTERMITTENT/LUMPY는 아직 붙은 엔진이 없어 Champion이 안 나옵니다).

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_batch uuid := gen_random_uuid();
  v_max_unverified date;
  v_m1 date;
  v_train_start date;
  v_train_end date;
  v_test_start date;
  v_test_end date;
  v_rows integer;
  v_prev_setting uuid;
  v_setting uuid;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  if exists (select 1 from core.practice_object where object_kind = 'FORECAST_SETTING') then
    raise notice '실습 사용 이력과 학습 기간이 이미 있습니다 — 건너뜁니다';
    return;
  end if;

  -- ── 1. 기존 미검증 사용 이력의 마지막 날짜 ───────────────────────
  -- 게이트가 보는 것과 똑같은 조건으로 셉니다(core.procurement_forecast_source_status).
  select max(u.use_date) into v_max_unverified
    from raw.usage_history u
    left join core.upload_batch b on b.batch_id = u.batch_id
   where b.batch_id is null
      or b.status <> 'IMPORTED'
      or b.import_type <> 'usage_history'
      or u.source_type is distinct from 'FILE_UPLOAD';

  v_m1 := greatest(
    (date_trunc('month', coalesce(v_max_unverified, date '2025-12-01')) + interval '1 month')::date,
    date '2026-01-01'
  );
  v_train_start := v_m1;
  v_train_end   := (date_trunc('month', v_m1 + interval '8 months') + interval '1 month - 1 day')::date;
  v_test_start  := (date_trunc('month', v_m1 + interval '9 months'))::date;
  v_test_end    := (date_trunc('month', v_m1 + interval '11 months') + interval '1 month - 1 day')::date;

  raise notice '미검증 사용 이력 마지막 날짜 = % → 실습 기간 학습 % ~ % · 검증 % ~ % · 기준월 %',
    coalesce(v_max_unverified::text, '(없음)'), v_train_start, v_train_end, v_test_start, v_test_end,
    to_char((date_trunc('month', v_m1 + interval '12 months'))::date, 'YYYY-MM');

  -- ── 2. STEP 4 적재 경로로 사용 이력을 넣는다 ─────────────────────
  create temporary table practice_usage on commit drop as
  select
    o.object_key as item_id,
    split_part(o.note, ':', 2)::int as seq,
    m.month_no,
    (v_m1 + make_interval(months => m.month_no - 1) + interval '14 days')::date as use_date,
    -- 기준량 × 계절성(±25%) × 완만한 증가 추세. 0이 나오지 않도록 최소 1로 clamp.
    greatest(1, round(
      (150 + 40 * split_part(o.note, ':', 2)::int)
      * (1 + 0.25 * sin(2 * pi() * (m.month_no - 1) / 12.0))
      * (1 + 0.01 * (m.month_no - 1))
    ))::numeric as qty
  from core.practice_object o
  cross join (select generate_series(1, 12) as month_no) m
  where o.object_kind = 'ITEM' and split_part(o.note, ':', 2)::int <= 10;

  select count(*) into v_rows from practice_usage;

  insert into core.upload_batch (batch_id, file_name, import_type, import_mode, total_rows, success_rows,
                                 warning_rows, error_rows, status, uploaded_by, uploaded_at)
  values (v_batch, '[실습용 ' || v_label || '] practice-usage-12m.csv', 'usage_history', 'append',
          v_rows, v_rows, 0, 0, 'VALIDATED', v_admin, now());

  insert into core.import_staging (batch_id, row_number, original_data, mapped_data, validation_status)
  select v_batch, row_number() over (order by u.item_id, u.month_no)::integer + 1,
         jsonb_build_object('item_id', u.item_id, 'use_date', u.use_date, 'qty', u.qty),
         -- usage_history는 commit_import_batch에 전용 매핑 분기가 없어 raw 컬럼명을 그대로 씁니다.
         jsonb_build_object(
           'usage_id',  'PRACTICE-' || u.item_id || '-' || to_char(u.use_date, 'YYYYMM'),
           'item_id',   u.item_id,
           'use_date',  u.use_date,
           'qty',       u.qty,
           'warehouse', 'MAIN',
           'note',      '실습용 수요',
           'source_record_id', 'PRACTICE-USAGE-' || u.item_id || '-' || to_char(u.use_date, 'YYYYMM')
         ),
         'SUCCESS'
    from practice_usage u;

  perform core.commit_import_batch(v_batch);
  perform core.register_practice_object(v_label, 'UPLOAD_BATCH', v_batch::text, '12개월 사용 이력 적재');

  -- ── 3. 학습/검증 기간 설정 ───────────────────────────────────────
  -- 활성 설정은 하나만 허용됩니다(부분 유니크 인덱스). 기존 것을 내리고 실습 설정을 올립니다.
  -- 되돌릴 id는 00-open-dataset.sql이 이미 restore_payload에 적어 두었습니다.
  select setting_id into v_prev_setting from core.forecast_setting where active order by updated_at desc limit 1;
  update core.forecast_setting set active = false, updated_at = now() where active;

  insert into core.forecast_setting (active, train_start, train_end, test_start, test_end, granularity,
                                     forecast_horizon, champion_metric, reference_model_id)
  values (true, v_train_start, v_train_end, v_test_start, v_test_end, 'MONTH', 9, 'WAPE', 'WMA_3M')
  returning setting_id into v_setting;

  perform core.register_practice_object(v_label, 'FORECAST_SETTING', v_setting::text,
    '학습 ' || v_train_start || '~' || v_train_end || ' · 검증 ' || v_test_start || '~' || v_test_end);

  raise notice '사용 이력 %행 적재 · 학습/검증 기간 설정 완료(이전 설정 %는 비활성화)',
    v_rows, coalesce(v_prev_setting::text, '(없음)');
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────

select train_start, train_end, test_start, test_end, granularity, forecast_horizon
  from core.forecast_setting where active;
-- 기대: 1행, granularity MONTH, forecast_horizon 9

-- ★ 가장 중요한 확인 — 학습·검증 기간에 출처 없는 행이 한 줄이라도 있으면 발주량이 계산되지 않습니다.
select split, count(*) as unverified_rows
  from (select 'TRAIN' as split, batch_id, source_type from core.v_train_demand
        union all select 'TEST', batch_id, source_type from core.v_test_actual) t
  left join core.upload_batch b on b.batch_id = t.batch_id
 where b.batch_id is null or b.status <> 'IMPORTED' or b.import_type <> 'usage_history'
    or t.source_type is distinct from 'FILE_UPLOAD'
 group by split;
-- 기대: **0행** (한 행이라도 나오면 그 기간에 더미 데이터가 걸쳐 있는 것입니다)

select count(*) as train_rows, count(distinct item_id) as train_items from core.v_train_demand;
-- 기대: 90행 · 10품목 (10품목 × 9개월)

select item_id, demand_type from analytics.v_sku_demand_profile
 where item_id in (select object_key from core.practice_object where object_kind = 'ITEM')
 order by item_id;
-- 기대: SMOOTH 또는 ERRATIC (INTERMITTENT/LUMPY면 Champion이 안 나와 발주계획이 막힙니다)
