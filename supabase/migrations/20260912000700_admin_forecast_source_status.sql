-- Task 15 fix round 1 — 리뷰 판정 3 · 4를 같은 파일에 담는다.
--   3) admin/forecast-runs가 원천 게이트(core.procurement_forecast_source_status)를 읽기 전용으로
--      보여줄 수 있게 하는 래퍼.
--   4) admin/backtest-runs의 채점 요약(개수 · WAPE 범위)을 화면 대신 SQL이 집계하는 뷰
--      (analytics.v_backtest_performance_summary, 파일 아래쪽).
--
-- ★ core.procurement_forecast_source_status(uuid)는 20260911000900_stage1_procurement_plan.sql
--   9번 섹션에서 public·anon·authenticated 모두에게서 EXECUTE가 회수됐다(발주계획 생성 로직 내부
--   전용). 그런데 그 함수가 읽는 원본(core.forecast_run · core.backtest_run · core.upload_batch ·
--   core.v_train_demand · core.v_test_actual)은 전부 core.is_active_user() 정책으로 이미 활성
--   사용자에게 열려 있다 — 즉 이 값을 관리자에게 보여주는 것은 "이미 조회 가능한 것보다 적게"
--   노출하는 일이라 권한 설계를 훼손하지 않는다(fix round 1 리뷰 판정).
-- ★ 그래도 이 래퍼는 admin 전용으로 다시 한 번 좁힌다 — core.is_admin()이 아니면 예외를 던진다.
--   원본 함수의 권한 · 동작은 전혀 바꾸지 않는다(그대로 호출만 한다).
-- ★ 여러 실행을 한 번에 조회하는 표 반환 함수로 만든다 — 화면이 실행 개수만큼 RPC를 왕복하지
--   않게 하기 위해서다.

create or replace function core.forecast_run_source_status_for_admin(p_run_ids uuid[])
returns table(run_id uuid, source_status text)
language plpgsql
stable
security definer
set search_path = core, analytics, public, pg_temp
as $$
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  return query
  select u.run_id, core.procurement_forecast_source_status(u.run_id)
  from unnest(p_run_ids) as u(run_id);
end;
$$;

comment on function core.forecast_run_source_status_for_admin(uuid[]) is
  'admin/forecast-runs 화면 전용 읽기 전용 래퍼(fix round 1). core.is_admin()으로 막고, '
  'core.procurement_forecast_source_status와 정확히 같은 값을 돌려준다 — 판정 로직을 다시 만들지 않는다.';

revoke all on function core.forecast_run_source_status_for_admin(uuid[]) from public, anon, authenticated;
grant execute on function core.forecast_run_source_status_for_admin(uuid[]) to authenticated;


-- ══ Backtest 채점 요약 — admin/backtest-runs가 SQL 집계 열을 읽게 한다(fix round 1) ══════════
--
-- ★ 이전엔 admin/backtest-runs 화면이 core.model_performance 원본 행을 내려받아 개수와
--   WAPE 최솟값·최댓값을 화면 쪽 순수 함수(lib/scm-model.ts)로 집계했다. 평균이 아니라 최솟값·
--   최댓값이라 AGENTS.md 2번("숫자 계산은 SQL이 한다")의 문언에 정확히 걸리는지는 애매했지만,
--   이 저장소에 화면 계층이 행을 훑어 집계하는 선례가 없었다(averageStockoutDays조차 SQL이
--   계산한 열을 읽는다) — 그 선례를 만들지 않기로 하고 집계를 뷰로 내린다.
-- ★ core.model_performance는 (backtest_run_id, model_id, item_id) 기준 — Backtest 실행 하나가
--   여러 모델 × 품목 조합을 채점하므로 backtest_run_id로 group by한다.
-- ★ fix round 2 — security_invoker = true를 빠뜨렸다. core.model_performance의 RLS는
--   core.is_active_user()로 SELECT를 제한하는데(20260828000600), 뷰가 소유자 권한(기본값)으로
--   돌면 비활성 인증 계정도 이 뷰를 거쳐 집계된 WAPE·건수를 읽는다. SCHEMA.md:91-92의 관례이고
--   바로 전날 20260912000600:176-180에서 같은 부류를 고치며 "이 저장소의 다른 운영 뷰와 같은
--   관례"라고 확정한 항목이다 — 이 저장소의 다른 analytics 뷰(core RLS 테이블을 참조하는 것)는
--   전부 이 옵션을 켠다.

create or replace view analytics.v_backtest_performance_summary
with (security_invoker = true)
as
select backtest_run_id,
  count(*) filter (where calculation_status = 'SUCCESS') as scored_count,
  count(*) filter (where calculation_status <> 'SUCCESS') as unavailable_count,
  min(wape) filter (where calculation_status = 'SUCCESS') as wape_min,
  max(wape) filter (where calculation_status = 'SUCCESS') as wape_max
from core.model_performance
group by backtest_run_id;

comment on view analytics.v_backtest_performance_summary is
  'Backtest 실행별 채점 요약(fix round 1) — core.model_performance를 backtest_run_id로 집계. '
  '평균·분위수가 아니라 개수와 min/max뿐이다.';

grant select on analytics.v_backtest_performance_summary to authenticated;
revoke all on analytics.v_backtest_performance_summary from anon, public;


-- ══ 수동 적용 후 확인 쿼리(SQL Editor 전용 — 주석을 풀어 실행) ══════════════
--
-- (a) admin 세션으로 최근 Forecast Run 5건의 원천 게이트 판정을 원본 함수와 대조한다(같아야 한다).
-- select r.run_id, r.status,
--        core.procurement_forecast_source_status(r.run_id) as via_original,
--        w.source_status as via_admin_wrapper
--   from core.forecast_run r
--   left join lateral (
--     select source_status from core.forecast_run_source_status_for_admin(array[r.run_id])
--   ) w on true
--  order by r.started_at desc limit 5;
--
-- (b) admin이 아닌 authenticated 세션으로 호출하면 42501(관리자 권한이 필요합니다)이 나야 한다.
-- select * from core.forecast_run_source_status_for_admin(array[]::uuid[]);
--
-- (c) v_backtest_performance_summary가 core.model_performance를 직접 집계한 것과 같은지 대조한다.
-- select * from analytics.v_backtest_performance_summary order by backtest_run_id;
-- select backtest_run_id, count(*) filter (where calculation_status = 'SUCCESS') as scored_count,
--        min(wape) filter (where calculation_status = 'SUCCESS') as wape_min,
--        max(wape) filter (where calculation_status = 'SUCCESS') as wape_max
--   from core.model_performance group by backtest_run_id order by backtest_run_id;
