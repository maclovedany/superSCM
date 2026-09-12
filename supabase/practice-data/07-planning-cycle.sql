-- 실습 데이터 7 · 기준월 취합 주기 열기
--
-- ★ 취합 주기가 열려야 화면 상단·사이드바의 기준월이 사유 코드(PLANNING_CYCLE_NOT_OPEN) 대신
--   실제 달로 바뀌고, 부서 수요 제출과 월말 재고 성과 화면이 그 달을 기준으로 동작합니다.
-- ★ 기준월은 04-usage-history.sql이 정한 검증 기간 다음 달입니다(하드코딩하지 않습니다).
-- ★ 부서 제출본(수요 제출)은 **일부러 넣지 않습니다.** 수업에서 마케팅부·서비스부 계정으로 직접
--   제출해 보는 것이 실습의 핵심이고, 미리 넣어 두면 그 단계를 건너뛰게 됩니다. 제출이 없어도
--   발주계획은 기준 Forecast를 조정 후보로 써서 정상 계산됩니다(Task 9b 판정).

\set ON_ERROR_STOP on

do $$
declare
  v_planner uuid;
  v_label text := 'PRACTICE-2026-09';
  v_plan_month date;
  v_cycle uuid;
begin
  -- PLAN_CONFIRM 또는 ADMIN이면 열 수 있습니다(core.open_planning_cycle).
  select user_id into v_planner from core.app_user where email = 'insightdany@naver.com' and active;
  if v_planner is null then
    raise exception '실습 SCM 품목담당자 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_planner::text, false);

  -- ── 순서 가드(fix round 1 · I2) ──────────────────────────────────
  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.', v_label;
  end if;

  select (date_trunc('month', test_end) + interval '1 month')::date into v_plan_month
    from core.forecast_setting where active;
  if v_plan_month is null then
    raise exception '활성 학습/검증 기간이 없습니다. 04-usage-history.sql을 먼저 실행하세요.';
  end if;

  select cycle_id into v_cycle from core.planning_cycle where plan_month = v_plan_month and is_active;
  if v_cycle is null then
    v_cycle := core.open_planning_cycle(v_plan_month);
  end if;
  perform core.register_practice_object(v_label, 'PLANNING_CYCLE', v_cycle::text,
    to_char(v_plan_month, 'YYYY-MM') || ' 기준월');

  raise notice '취합 주기 열기 완료 — 기준월 % · cycle %', to_char(v_plan_month, 'YYYY-MM'), v_cycle;
end $$;

-- 확인
select cycle_id, plan_month, submission_deadline, status, is_active from analytics.v_current_planning_cycle;
-- 기대: 1행, plan_month가 채워지고 reason_code는 null(PLANNING_CYCLE_NOT_OPEN이 아니어야 합니다)
