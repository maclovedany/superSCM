-- 실습 데이터 8 · 검증 — 여기서 확인하고 수업에 들어갑니다
--
-- 각 쿼리 아래에 기대값을 적었습니다. 하나라도 다르면 그 앞 스크립트를 다시 보세요.
-- 이 파일은 아무것도 바꾸지 않습니다(조회만 합니다).

\set ON_ERROR_STOP on

-- ══ 1. 실습 표식이 제대로 붙었는가 ═══════════════════════════════════

select * from analytics.v_practice_data_status;
-- 기대: 1행 · has_practice_data = true · label = 'PRACTICE-2026-09'
--       affects_inventory = true · affects_month_end_kpi = true
--       (affects_procurement_plan은 아래 3번에서 발주계획을 만든 뒤 true가 됩니다)

select object_kind, count(*) from analytics.v_practice_object where active group by object_kind order by object_kind;
-- 기대(대략): ITEM 11 · ITEM_POLICY 10 · ITEM_POLICY_REVISION 10 · SUPPLIER 5 · SUPPLIER_DEPARTURE 5 ·
--             SUPPLY_ENTITY 5 · BUSINESS_CALENDAR 19 · CALENDAR_READINESS 24 · UPLOAD_BATCH 3 ·
--             FORECAST_SETTING 1 · FORECAST_RUN 1 · BACKTEST_RUN 1 · PLANNING_CYCLE 1

select batch_id, file_name, import_type, status from core.upload_batch
 where batch_id in (select object_key::uuid from core.practice_object where object_kind = 'UPLOAD_BATCH')
 order by uploaded_at;
-- 기대: 3행 모두 file_name이 '[실습용 PRACTICE-2026-09] …' 로 시작하고 status = 'IMPORTED'
--       (관리자 화면 /admin/data-management 의 적재 이력에서 이 이름이 그대로 보입니다)


-- ══ 2. 마스터 · 정책 준비 상태 ═══════════════════════════════════════

select * from analytics.v_master_readiness;
-- 기대: n_prep_days_unset 0 · n_suppliers 5 · n_departure_rules 5 · n_calendar_months_ready 24

select count(*) filter (where order_blocked) as blocked_items,
       count(*) filter (where not order_blocked) as ready_items
  from analytics.v_item_policy ip
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = ip.item_id;
-- 기대: blocked_items 0 · ready_items 10 (승인 절차를 거쳤으므로 차단이 없어야 합니다)


-- ══ 3. 원천 게이트와 발주계획 ═══════════════════════════════════════

select r.run_id, core.procurement_forecast_source_status(r.run_id) as source_status
  from core.forecast_run r
  join core.practice_object o on o.object_kind = 'FORECAST_RUN' and o.object_key = r.run_id::text;
-- ★ 기대: VERIFIED. 이것이 아니면 아래 발주계획이 전부 계산 불가로 나옵니다(06의 안내 참고).

-- 발주계획을 실제로 만들어 봅니다(SCM 품목담당자 자격). 이 블록은 계획 1건을 만들고 등기합니다.
do $$
declare
  v_planner uuid;
  v_plan_month date;
  v_plan uuid;
  v_unavailable integer;
begin
  select user_id into v_planner from core.app_user where email = 'insightdany@naver.com' and active;
  perform set_config('request.jwt.claim.sub', v_planner::text, false);

  select (date_trunc('month', test_end) + interval '1 month')::date into v_plan_month
    from core.forecast_setting where active;

  v_plan := core.build_procurement_plan(v_plan_month, null);
  perform core.register_practice_object('PRACTICE-2026-09', 'PROCUREMENT_PLAN', v_plan::text,
    to_char(v_plan_month, 'YYYY-MM') || ' 실습 발주계획');

  select n_unavailable_lines into v_unavailable from analytics.v_procurement_plan where plan_id = v_plan;
  raise notice '발주계획 % 생성 — 계산 불가 라인 %개(0이어야 정상)', v_plan, v_unavailable;
end $$;

select plan_month, version, status, source_status, n_items, n_lines, n_calculated_lines,
       n_unavailable_lines, confirmable
  from analytics.v_procurement_plan
 order by plan_month desc, version desc limit 3;
-- 기대: source_status VERIFIED · n_items 10 · n_lines 60(10품목 × 6개월) ·
--       n_unavailable_lines 0 · confirmable true

select month_no, target_month, n_items, total_final_order_qty, total_projected_month_end_qty,
       total_projected_inventory_value, kpi_reason_code
  from analytics.v_procurement_plan_kpi
 where plan_id = (select plan_id from analytics.v_procurement_plan order by built_at desc limit 1)
 order by month_no;
-- 기대: 6행, 합계가 전부 숫자(null이면 계산 불가 라인이 있다는 뜻) · kpi_reason_code null

-- MOQ 올림 손검산 — stage1 §7 "필요량 120 · MOQ 50 → 150"
select selected_qty, selection_reason, effective_moq, final_order_qty
  from core.calculate_procurement_plan_month(1, 100, null, 0, 80, 30, 600, 50, 1000);
-- 기대: 120 · DOS_TARGET · 50 · 150

-- 실습 품목 중 MOQ 50인 품목의 발주량이 50 단위로 올림되었는지
select l.item_id, l.month_no, l.selected_qty, l.effective_moq, l.final_order_qty
  from analytics.v_procurement_plan_line l
 where l.plan_id = (select plan_id from analytics.v_procurement_plan order by built_at desc limit 1)
   and l.effective_moq = 50
 order by l.month_no;
-- 기대: final_order_qty가 전부 50의 배수


-- ══ 4. 재고와 사유 코드 경로 ═════════════════════════════════════════

-- ★ SCM 계정(STOCK_VIEW_ALL)으로 조회해야 행이 나옵니다.
do $$ declare v uuid; begin
  select user_id into v from core.app_user where email = 'insightdany@naver.com' and active;
  perform set_config('request.jwt.claim.sub', v::text, false);
end $$;

select item_id, normal_warehouse_qty, available_qty, reason_code
  from analytics.v_available_stock
 where item_id in (select object_key from core.practice_object where object_kind = 'ITEM')
 order by item_id;
-- 기대: 11행. 10개는 숫자, **1개(seq 11)는 null + INVENTORY_SCOPE_UNCLASSIFIED**.
--       0으로 채워져 있으면 안 됩니다 — 사유 코드 경로가 살아 있는지 확인하는 자리입니다.

select plan_month, n_items, n_qty_available, n_month_end_snapshot_missing,
       n_inventory_scope_unclassified, total_actual_qty, total_actual_value, n_unit_price_unset
  from analytics.v_inventory_performance_kpi
 order by plan_month desc limit 2;
-- 기대: 기준월 행에서 total_actual_qty · total_actual_value가 숫자


-- ══ 5. 화면에서 눈으로 확인할 것 ═════════════════════════════════════
--
--  /admin/practice-data          실습 묶음 · 등기 객체 · 제거 방법
--  /admin/data-management        적재 이력 3건에 '실습용' 배지와 '[실습용 …]' 파일명
--  /inventory                    상단 "이 화면의 숫자는 실습용 데이터 기반입니다" 배너
--  /analysis/inventory-performance  같은 배너 + 월말 재고 수량·금액
--  /procurement-plans            계획 목록 행에 '실습용' 태그
--  /procurement-plans/<plan_id>  상단 배너 + 라인별 계산 단계
--  /dashboard                    기준월이 사유 코드가 아니라 실제 달로 표시 + 배너
--
-- 배너가 보이지 않으면 analytics.v_practice_data_status의 affects_* 를 먼저 확인하세요.
