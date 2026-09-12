-- 실습 데이터 9 · 발주계획 생성 (선택 · ★ 되돌릴 수 없습니다)
--
-- ══════════════════════════════════════════════════════════════════════
--  ⚠️ 경고 — 이 파일을 실행하면 **실습 데이터를 완전히 제거할 수 없게 됩니다.**
--
--  core.procurement_plan은 Task 9b의 guard_procurement_plan_mutation 트리거가
--  **DRAFT를 포함한 모든 상태에서 DELETE를 막습니다**(승인본만이 아닙니다).
--  그래서 한 번 계획을 만들면:
--    · 계획 · 라인 · 이력이 영구히 남습니다.
--    · 그 계획이 참조하는 Forecast 실행 · Backtest · Champion · 모델 성능도
--      on delete restrict 때문에 함께 남습니다.
--    · 계획 라인이 참조하는 품목과 그 정책 · 적재 원본도 남습니다
--      (그러지 않으면 "없는 품목을 가리키는 계획 라인"이 되기 때문입니다).
--  core.remove_practice_dataset은 이것들을 지우지 않고 사유와 함께 보고합니다
--  (PLAN_IMMUTABLE_HISTORY · PLAN_REFERENCES_ITEM · RETAINED_FOR_BLOCKED_ITEM).
--  남은 객체의 등기는 유지되므로 화면에는 계속 '실습용'으로 표시됩니다.
--
--  수업에서 발주계획 단계를 보여 주려면 실행하세요. 그럴 계획이 없다면 실행하지 마세요.
--  ★ 실행 전에 08-verify.sql 3절의 source_status가 **VERIFIED**인지 반드시 확인하세요.
--    VERIFIED가 아니면 모든 라인이 계산 불가인 계획이 영구히 남습니다.
-- ══════════════════════════════════════════════════════════════════════
--
-- ★ 화면(/procurement-plans)에서 SCM 품목담당자 계정으로 직접 "발주계획 계산"을 눌러도 결과는
--   같습니다. 수업에서 그 버튼을 눌러 보게 할 거라면 이 파일 대신 화면을 쓰세요 — 다만 그때도
--   위 경고는 그대로 적용됩니다(화면에서 만든 계획도 지울 수 없습니다).

\set ON_ERROR_STOP on

do $$
declare
  v_planner uuid;
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_plan_month date;
  v_plan uuid;
  v_source text;
  v_unavailable integer;
  v_lines integer;
begin
  select user_id into v_admin   from core.app_user where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  select user_id into v_planner from core.app_user where email = 'insightdany@naver.com' and active;
  if v_admin is null or v_planner is null then
    raise exception '실습 SCM 품목담당자(ADMIN) 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- ── 순서 가드 ────────────────────────────────────────────────────
  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.', v_label;
  end if;
  if not exists (select 1 from core.practice_object where object_kind = 'FORECAST_RUN') then
    raise exception '실습 Forecast 실행이 없습니다. 06-forecast.sql을 먼저 실행하세요.';
  end if;

  select (date_trunc('month', test_end) + interval '1 month')::date into v_plan_month
    from core.forecast_setting where active;
  if v_plan_month is null then
    raise exception '활성 학습/검증 기간이 없습니다. 04-usage-history.sql을 먼저 실행하세요.';
  end if;

  -- ★ 원천 게이트가 통과하지 못하면 만들지 않습니다. 계산 불가 계획도 지울 수 없기 때문입니다.
  select core.procurement_forecast_source_status(o.object_key::uuid) into v_source
    from core.practice_object o where o.object_kind = 'FORECAST_RUN' limit 1;
  if v_source is distinct from 'VERIFIED' then
    raise exception '원천 게이트가 VERIFIED가 아닙니다(현재 %). 계획을 만들면 계산 불가 상태로 영구히 남습니다 — 06-forecast.sql의 안내를 먼저 보세요.', v_source;
  end if;

  if exists (select 1 from core.practice_object where object_kind = 'PROCUREMENT_PLAN') then
    raise notice '실습 발주계획이 이미 있습니다 — 건너뜁니다';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_planner::text, false);
  v_plan := core.build_procurement_plan(v_plan_month, null);

  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform core.register_practice_object(v_label, 'PROCUREMENT_PLAN', v_plan::text,
    to_char(v_plan_month, 'YYYY-MM') || ' 실습 발주계획(삭제 불가 — 제거 시 blocked로 보고됨)');

  select n_lines, n_unavailable_lines into v_lines, v_unavailable
    from analytics.v_procurement_plan where plan_id = v_plan;
  raise notice '발주계획 % 생성 — 라인 %개 · 계산 불가 %개(0이어야 정상) · 기준월 %',
    v_plan, v_lines, v_unavailable, to_char(v_plan_month, 'YYYY-MM');
  if v_unavailable > 0 then
    raise notice '★ 계산 불가 라인이 있습니다. analytics.v_procurement_plan_blocker 로 사유를 확인하세요.';
  end if;
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────

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
-- 기대: 6행, 합계가 전부 숫자 · kpi_reason_code null

-- MOQ 50인 실습 품목의 발주량이 50 단위로 올림되었는지
select l.item_id, l.month_no, l.selected_qty, l.effective_moq, l.final_order_qty
  from analytics.v_procurement_plan_line l
 where l.plan_id = (select plan_id from analytics.v_procurement_plan order by built_at desc limit 1)
   and l.effective_moq = 50
 order by l.month_no;
-- 기대: final_order_qty가 전부 50의 배수

select plan_id, is_practice from analytics.v_practice_plan order by is_practice desc limit 5;
-- 기대: 방금 만든 계획이 is_practice = true (화면 목록에 '실습용' 태그가 붙습니다)

select affects_procurement_plan from analytics.v_practice_data_status;
-- 기대: true (이제 발주계획 화면에도 배너가 뜹니다)
