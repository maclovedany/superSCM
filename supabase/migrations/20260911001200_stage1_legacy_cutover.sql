-- Task 13 · 레거시 전환과 최종 회귀 검증 — Supabase 쪽 변경분
--
-- 목적: 신규 운영 흐름(Task 1~12)이 갖춰진 뒤 상충하는 레거시 진입점만 걷어내고 데이터는
-- 보존한다. 이 마이그레이션은 새 테이블·뷰를 만들지 않는다 — 과거 legacy 데모용 `public`
-- 스키마 테이블 6개의 접근 권한만 회수하고 폐기 표시를 남긴다.
--
-- 컨트롤러 판정(요약)
--   1) `public.planning_runs · ol_demand · sfdc_pipeline · bulk_deals · historical_actuals ·
--      demand_confirmations`(20260813000100_create_procurement_demand_core.sql)는 즉시 drop하지
--      않는다. 앱 코드(app/·components/·lib/) 전체를 검색해 이 6개 테이블을 참조하는 곳이
--      하나도 없음을 확인했다(레거시 `/workflow` 프로토타입조차 브라우저 로컬 state로만
--      동작하고 이 테이블을 읽거나 쓰지 않는다). 그래서 drop 대신 `authenticated` 권한만
--      회수하고 `comment on table`로 폐기 표시만 남긴다 — 과거 5회차 수업에서 이 테이블에
--      쌓인 데이터가 있어도 그대로 보존된다.
--   2) 20260828000100_step2_auth_rbac.sql이 이 6개 테이블에 `authenticated`에게
--      select/insert/update/delete 권한과 `<table>_user_select`(전체 사용자 읽기) ·
--      `<table>_admin_mutation`(관리자 쓰기) RLS 정책을 부여해 뒀다. 권한을 회수해도 정책이
--      남아 있으면 다음 번 누군가 `grant`를 되살릴 때 조용히 다시 열릴 수 있으므로, 정책도
--      함께 지운다. RLS는 켜진 채로 둔다(비활성화하면 이후 실수로 grant가 생겨도 즉시
--      전체 공개된다).
--   3) `raw.item_substitute`(STEP 3, 20260828000200_step3_data_isolation.sql)는 이번 검토에서도
--      건드리지 않는다 — `app/`·`components/`·`lib/` 전체에서 참조가 없고(테스트 계약
--      `lib/forecast-data-contract.test.ts`가 raw 시드 테이블 존재만 확인), 신규 analytics
--      뷰·발주계획 계산·메뉴 어디에도 연결되지 않았다(향후논의사항.md "긴급 대체품 관리"
--      단계에서만 다시 논의). 그래서 이 파일은 `raw.item_substitute`에 대해 아무 것도
--      바꾸지 않는다 — 확인만 하고 SQL은 그대로 둔다.
--   4) `/admin/workflow` → `/procurement-plans` 전환과 관리자 메뉴에서 "레거시 업무 플로우"
--      링크 제거, `/workflow` 참고용 배너 추가는 앱 코드 변경이라 이 파일에 없다
--      (lib/menu.ts, app/(admin)/admin/workflow/page.tsx, app/(legacy)/workflow/page.tsx 참고).
--
-- 다시 실행해도 안전합니다(모든 문장이 조건부 또는 멱등). 운영 테이블에 예시 데이터를 넣지
-- 않습니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.

do $legacy_cutover$
declare
  table_name text;
begin
  foreach table_name in array array[
    'planning_runs', 'ol_demand', 'sfdc_pipeline', 'bulk_deals',
    'historical_actuals', 'demand_confirmations'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      -- 남아 있는 RLS 정책부터 지운다(2번 판정) — 권한 회수 뒤에도 정책이 남으면
      -- 나중에 grant가 되살아날 때 조용히 다시 전체 공개될 수 있다.
      execute format('drop policy if exists %I on public.%I', table_name || '_user_select', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_admin_mutation', table_name);

      -- authenticated · anon 모두에서 권한을 회수한다. RLS는 켜진 채로 둔다.
      execute format('revoke all on public.%I from authenticated', table_name);
      execute format('revoke all on public.%I from anon', table_name);

      execute format(
        'comment on table public.%I is %L',
        table_name,
        'DEPRECATED(Task 13, 2026-09-11): 5회차 수업용 legacy 발주계획 프로토타입 테이블. '
        || '신규 운영 화면·계산은 core/analytics 스키마만 쓴다. drop하지 않고 데이터는 보존하되 '
        || 'authenticated/anon 권한을 회수했다 — 새 코드에서 다시 연결하지 않는다.'
      );
    end if;
  end loop;
end;
$legacy_cutover$;

-- ══ 확인 쿼리(운영 DB에서 수동 확인용, 실행하지 않음) ═══════════════
--
-- 1) 6개 테이블 모두 authenticated·anon 권한이 비어 있어야 한다(행이 하나도 없어야 정상):
-- select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public'
--    and table_name in ('planning_runs','ol_demand','sfdc_pipeline','bulk_deals',
--                        'historical_actuals','demand_confirmations')
--    and grantee in ('authenticated','anon');
--
-- 2) 폐기 comment가 6개 테이블 모두에 달려 있어야 한다:
-- select relname, obj_description(oid, 'pg_class') as comment
--   from pg_class
--  where relnamespace = 'public'::regnamespace
--    and relname in ('planning_runs','ol_demand','sfdc_pipeline','bulk_deals',
--                     'historical_actuals','demand_confirmations');
--
-- 3) 정책이 모두 사라졌어야 한다(0행):
-- select schemaname, tablename, policyname
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('planning_runs','ol_demand','sfdc_pipeline','bulk_deals',
--                       'historical_actuals','demand_confirmations');
--
-- 4) 기존 데이터는 그대로 보존됐는지(수업 중 넣은 값이 있었다면 행 수가 그대로여야 한다):
-- select 'planning_runs' t, count(*) from public.planning_runs
-- union all select 'ol_demand', count(*) from public.ol_demand
-- union all select 'sfdc_pipeline', count(*) from public.sfdc_pipeline
-- union all select 'bulk_deals', count(*) from public.bulk_deals
-- union all select 'historical_actuals', count(*) from public.historical_actuals
-- union all select 'demand_confirmations', count(*) from public.demand_confirmations;
--
-- 5) raw.item_substitute는 이 마이그레이션이 아무 것도 바꾸지 않았으므로 STEP 3 적용 이후와
--    동일해야 한다(행수·권한 변화 없음) — 별도 확인 쿼리 불필요.
