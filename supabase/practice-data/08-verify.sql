-- 실습 데이터 8 · 검증 — 여기서 확인하고 수업에 들어갑니다
--
-- ★ 이 파일은 **데이터를 만들거나 바꾸지 않습니다.** 조회만 합니다(4절에서 조회 권한을 맞추려고
--   세션 사용자만 지정합니다 — 저장된 데이터는 건드리지 않습니다).
--
-- ★★ fix round 1 (C3 · I3) — 이전 판은 이 파일 안에서 발주계획을 만들었습니다. 그런데
--    core.procurement_plan은 Task 9b의 guard_procurement_plan_mutation이 **DRAFT를 포함한 모든
--    상태에서 DELETE를 막습니다.** 즉 "검증만 해 보려고" 이 파일을 돌리면 계획·라인·이력이 영구히
--    남고, on delete restrict 때문에 Forecast 실행·Backtest·Champion까지 함께 묶여 완전 제거가
--    불가능해집니다. 그래서 계획 생성을 **09-build-plan.sql로 분리**했습니다.
--    이 파일은 안전하게 몇 번이든 다시 돌려도 됩니다.
--
-- 각 쿼리 아래에 기대값을 적었습니다. 하나라도 다르면 그 앞 스크립트를 다시 보세요.

\set ON_ERROR_STOP on

-- ══ 1. 실습 표식이 제대로 붙었는가 ═══════════════════════════════════

select * from analytics.v_practice_data_status;
-- 기대: 1행 · has_practice_data = true · label = 'PRACTICE-2026-09'
--       affects_inventory = true · affects_month_end_kpi = true
--       (affects_procurement_plan은 09-build-plan.sql을 돌린 뒤에 true가 됩니다)

select object_kind, count(*) from analytics.v_practice_object where active group by object_kind order by object_kind;
-- 기대(대략): ITEM 11 · ITEM_POLICY 10 · ITEM_POLICY_REVISION 10 · SUPPLIER 5 · SUPPLIER_DEPARTURE 5 ·
--             SUPPLY_ENTITY 5 · BUSINESS_CALENDAR 19 · CALENDAR_READINESS 12 · UPLOAD_BATCH 3 ·
--             FORECAST_SETTING 1 · FORECAST_RUN 1 · BACKTEST_RUN 1 · PLANNING_CYCLE 1

-- 실습 품목에 "실습용으로 부여한" 품목구분이 등기에 드러나는지(화면에도 이 문구가 보입니다)
select object_key as item_id, note from analytics.v_practice_object
 where object_kind = 'ITEM' order by substring(note from 'seq:([0-9]+)')::int;
-- 기대: 11행. note에 'seq:N · 품목구분 …(실습용으로 부여, dim_item의 실제 분류 아님)'

select batch_id, file_name, import_type, status from core.upload_batch
 where batch_id in (select object_key::uuid from core.practice_object where object_kind = 'UPLOAD_BATCH')
 order by uploaded_at;
-- 기대: 3행 모두 file_name이 '[실습용 PRACTICE-2026-09] …' 로 시작하고 status = 'IMPORTED'
--       (관리자 화면 /admin/data-management 의 적재 이력에서 이 이름과 '실습용' 배지가 보입니다)


-- ══ 2. 마스터 · 정책 준비 상태 ═══════════════════════════════════════

select * from analytics.v_master_readiness;
-- 기대: n_prep_days_unset 0 · n_suppliers 5 · n_departure_rules 5 · n_calendar_months_ready 12
--       (2026년만 공휴일을 넣었으므로 12입니다 — 01-master.sql 주석 참고)

select count(*) filter (where order_blocked) as blocked_items,
       count(*) filter (where not order_blocked) as ready_items
  from analytics.v_item_policy ip
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = ip.item_id;
-- ★ 기대: blocked_items 0 · ready_items 10
--   blocked_items가 10이면 03-item-policies.sql이 중간에 롤백된 것입니다(승인 이력이 없다는 뜻).

select count(*) as approved_revisions from core.item_policy_revision where status = 'APPROVED';
-- 기대: 10 (요청 → SCM팀장 승인이 실제로 일어났는지 확인)


-- ══ 3. 원천 게이트 ═══════════════════════════════════════════════════

select r.run_id, r.status, r.train_start, r.train_end,
       r.train_input_row_count, left(r.train_input_md5, 12) as train_md5,
       core.procurement_forecast_source_status(r.run_id) as source_status
  from core.forecast_run r
  join core.practice_object o on o.object_kind = 'FORECAST_RUN' and o.object_key = r.run_id::text;
-- ★ 기대: status SUCCESS · train_input_md5 not null · source_status = 'VERIFIED'
--   VERIFIED가 아니면 09를 돌리지 마세요 — 모든 라인이 계산 불가로 나오고, 그 계획은 지울 수 없습니다.

select c.item_id, c.champion_model_id, round(c.wape, 4) as wape
  from analytics.v_champion_model c
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = c.item_id
 order by c.item_id;
-- 기대: 10행, champion_model_id not null

-- MOQ 올림 손검산 — stage1 §7 "필요량 120 · MOQ 50 → 150" (저장된 데이터를 읽지 않는 순수 함수)
select selected_qty, selection_reason, effective_moq, final_order_qty
  from core.calculate_procurement_plan_month(1, 100, null, 0, 80, 30, 600, 50, 1000);
-- 기대: 120 · DOS_TARGET · 50 · 150


-- ══ 4. 재고와 사유 코드 경로 ═════════════════════════════════════════

-- ★ SCM 계정(STOCK_VIEW_ALL)으로 조회해야 행이 나옵니다. 데이터는 바뀌지 않습니다.
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

select * from analytics.v_current_planning_cycle;
-- 기대: plan_month가 채워지고 reason_code는 null


-- ══ 5. 화면에서 눈으로 확인할 것 ═════════════════════════════════════
--
--  /admin/practice-data          실습 묶음 · 등기 객체(부여한 품목구분 포함) · 제거 방법
--  /admin/data-management        적재 이력 3건에 '실습용' 배지와 '[실습용 …]' 파일명
--  /inventory                    상단 "이 화면의 숫자는 실습용 데이터 기반입니다" 배너
--  /orders/new                   같은 배너(주문 가능 수량이 실습 재고에서 나옵니다)
--  /procurement-plans/item-policies  같은 배너 + 품목 행에 '실습용' 태그
--  /analysis/inventory-performance   같은 배너 + 월말 재고 수량·금액
--  상단바 · 사이드바              기준월 옆에 '실습' 표시(실습 취합 주기일 때)
--  /dashboard                    기준월이 실제 달로 표시 + 배너
--  09를 돌린 뒤:
--  /procurement-plans            계획 목록 행에 '실습용' 태그
--  /procurement-plans/<plan_id>  상단 배너 + 라인별 계산 단계
--  /procurement-plans/schedule   같은 배너 + 발주일 · 입고일
--
-- 배너가 보이지 않으면 analytics.v_practice_data_status의 affects_* 를 먼저 확인하세요.
