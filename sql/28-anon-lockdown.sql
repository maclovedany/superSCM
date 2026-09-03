-- anon 잠금 — 로그인하지 않은 사용자에게서 데이터를 완전히 거둡니다.
--
-- ★ 왜 필요한가
--
--   sql/01-grants.sql 은 core · analytics 의 모든 테이블과 뷰에 select 를
--   anon 에게 줍니다. anon 은 "로그인하지 않은 방문자" 입니다.
--   PostgREST 는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 만 들고 온 요청을
--   anon 으로 처리합니다. 그 키는 비밀이 아닙니다 — 모든 방문자의 브라우저
--   번들 안에 들어 있습니다.
--
--   그래서 지금은 아래 한 줄이면 로그인 없이 공급망 데이터 전체가 나옵니다.
--
--     curl -H "apikey: <publishable>" -H "Accept-Profile: analytics" \
--          "https://<project>.supabase.co/rest/v1/v_stockout_risk?select=*"
--
--   확인된 노출: analytics.v_leadtime_gap (거래처명 · 국가 · 리드타임 통계),
--   analytics.v_stockout_risk (품목명 · 재고 · 일평균 사용량),
--   analytics.v_usage_profile, analytics.v_data_coverage 등.
--
--   sql/03-auth.sql 의 규칙은 정반대입니다 —
--   "anon 에게는 아무것도 주지 않습니다. 로그인해야 볼 수 있습니다."
--   이 파일이 그 규칙을 실제 권한으로 만듭니다.
--
-- ★ 왜 sql/01 을 고치지 않는가
--
--   앞 파일은 그것만으로도 돌아가야 합니다. 01 을 고치면 "01 까지만 적용한
--   데이터베이스" 가 다른 물건이 됩니다. 권한의 최종 상태는 항상 이 파일이
--   정합니다. 순서상 마지막에 두고, 여러 번 실행해도 같은 결과가 됩니다.
--
-- ★ 화면은 아무것도 잃지 않습니다
--
--   middleware.ts 가 로그인하지 않은 요청을 /login 으로 보내고, 모든 서버
--   컴포넌트가 첫 줄에서 requireUser() 를 부릅니다. 화면의 조회는 전부
--   쿠키 세션이 있는 authenticated 로 나갑니다. 브라우저에서 직접 DB 를
--   읽는 코드는 한 곳도 없습니다 (lib/supabase/client.ts 를 쓰는 화면 없음).
--
-- ★ anon 이 남아 있어야 하는 곳 — 아래 §5 에서 함수 실행만 되돌려줍니다
--
--   ① Vercel Cron   app/api/cron/scan-alerts/route.ts — 세션이 없습니다.
--   ② External API  app/api/v1/** POST — 세션이 아니라 API 키로 인증합니다.
--
--   둘 다 security definer 함수 안에서 자기 비밀값(app.cron_secret · 키 해시)을
--   다시 검사합니다. 실행 권한을 준다고 데이터가 열리지 않습니다.
--
-- ★ 이 파일이 깨는 것 — /api/v1 의 GET (Outbound)
--
--   app/api/v1 의 GET 라우트는 lib/api/outbound.ts 를 통해 analytics 뷰를
--   그냥 select 합니다. 그 조회는 세션이 없어 anon 으로 나갑니다. 즉 지금은
--   sql/01 의 무차별 grant 덕분에만 돌아갑니다 — 노출 구멍과 같은 문입니다.
--   그 문을 닫으면 GET 라우트는 502(UPSTREAM_ERROR) 를 돌려줍니다.
--
--   이미 같은 이유로 깨져 있는 경로가 있습니다: sql/23-atp-sales.sql 은
--   analytics.v_atp 와 core.check_order_feasibility 를 anon 에게서 거두므로
--   GET /api/v1/atp 는 이 파일 없이도 501/502 입니다. Outbound 의 DB 접근
--   방식이 처음부터 어긋나 있었다는 뜻입니다.
--
--   ★ Inbound 는 이미 같은 문제를 겪고 고쳤습니다 — 그것이 본보기입니다.
--     lib/import/repository.ts 의 loadValidationContext 도 뷰 네 곳을 anon 으로
--     직접 읽고 있었습니다. sql/26 §7-2 가 키 해시를 검사하고 같은 네 곳을 대신
--     읽어주는 core.api_validation_context 를 두어, 뷰는 닫힌 채로 두고 함수
--     하나만 열었습니다. Outbound 도 같은 방법으로 닫을 수 있습니다.
--
--   고치는 방법은 뷰를 anon 에게 다시 여는 것이 아닙니다. 그러면 구멍이 그대로입니다 —
--   Outbound 가 읽는 뷰는 아홉 개이고, 그 안에 이 파일이 닫으려는 v_stockout_risk 와
--   v_leadtime_gap 이 들어 있습니다. 다시 열면 §1 의 revoke 가 사실상 없던 일이 됩니다.
--   둘 중 하나입니다.
--     (가) Outbound 조회를 서버에서 secret 키(sb_secret_) 클라이언트로 보낸다.
--          Inbound 가 이미 키 해시로 인증을 끝냈으므로 문은 하나 더 늘지 않습니다.
--     (나) core.api_validation_context 처럼 p_key_hash 를 받아 스스로 검사하는
--          security definer 함수를 뷰마다 만들고, outbound.ts 가 그것을 부른다.
--   어느 쪽도 이 파일의 일이 아닙니다 — lib/api/** 수정이 필요합니다. 권한만 정합니다.

-- ──────────────────────────────────────────────────────────────
-- §1  테이블 · 뷰 — anon 에게서 전부 거둡니다
-- ──────────────────────────────────────────────────────────────
--
-- 뷰도 all tables 에 포함됩니다 (sql/01-grants.sql 과 같은 이유).
-- select 만이 아니라 all 입니다. sql/02-policies.sql 이 core.leadtime_plan ·
-- core.usage_profile 에 insert/update/delete 까지 줬던 적이 있습니다.

revoke all on all tables    in schema core      from anon;
revoke all on all tables    in schema analytics from anon;
revoke all on all sequences in schema core      from anon;
revoke all on all sequences in schema analytics from anon;

-- anon 은 public 롤의 권한도 함께 씁니다. 덤프나 뒤 파일이 public 에
-- 무언가를 줬다면 anon 에게서 거둬도 그대로 읽힙니다. 그래서 public 도 함께
-- 닫습니다. 프로젝트 파일 중 core · analytics 의 테이블을 public 에 주는
-- 곳은 없으므로, 이 두 줄이 authenticated 에게서 빼앗는 것은 없습니다.
revoke all on all tables in schema core      from public;
revoke all on all tables in schema analytics from public;

-- raw 는 원래 앱에 열지 않습니다 (sql/08-import.sql §3 은 authenticated 에게만 줍니다).
-- raw 는 sql/08 이 만듭니다. 아직 없을 수 있으므로 존재를 확인하고 거둡니다.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'raw') then
    execute 'revoke all on all tables in schema raw from anon, public';
    execute 'revoke all on schema raw from anon';
  end if;
end
$$;

-- ──────────────────────────────────────────────────────────────
-- §2  앞으로 만들 객체 — 자동 grant 를 끕니다
-- ──────────────────────────────────────────────────────────────
--
-- sql/01-grants.sql §3 의 alter default privileges 가 살아 있으면, 새 뷰를
-- 하나 만들 때마다 anon 에게 select 가 다시 붙습니다. §1 의 revoke 는
-- 그 시점에 존재하는 객체만 건드리므로, 이 기본값을 끄지 않으면 구멍이
-- 조용히 다시 열립니다.
--
-- ★ alter default privileges 는 "현재 롤이 만든 객체" 의 기본값을 바꿉니다.
--   sql/01 도 이 파일도 Supabase SQL Editor(= postgres)에서 실행하므로
--   같은 롤의 기본값을 되돌립니다. 다른 롤로 01 을 돌린 적이 있다면
--   맨 아래 확인 쿼리 ③ 에 그 롤이 남아 보입니다.

alter default privileges in schema core      revoke select on tables from anon;
alter default privileges in schema analytics revoke select on tables from anon;

-- ──────────────────────────────────────────────────────────────
-- §3  스키마 — analytics 는 문 자체를 닫습니다
-- ──────────────────────────────────────────────────────────────
--
-- analytics 에는 anon 이 부를 것이 하나도 없습니다. usage 를 거두면
-- 뒤에 누가 실수로 grant select 를 하나 더 써도 anon 은 스키마에
-- 들어오지 못합니다. 방어가 한 겹 더 생깁니다.
--
-- core 는 usage 를 남깁니다. §5 의 함수를 실행하려면 스키마에 들어와야
-- 하기 때문입니다. 스키마 usage 만으로는 어떤 데이터도 보이지 않습니다.

revoke all    on schema analytics from anon;
revoke create on schema core     from anon;
grant  usage  on schema core     to   anon;   -- §5 함수 실행에 필요합니다

-- ──────────────────────────────────────────────────────────────
-- §4  함수 — 기본값이 "누구나 실행" 입니다. 먼저 전부 닫습니다
-- ──────────────────────────────────────────────────────────────
--
-- PostgreSQL 은 새 함수의 execute 를 public 에 자동으로 줍니다. 그래서
-- 뒤 파일들이 revoke ... from public 을 빠뜨린 함수는 지금도 anon 이
-- 부를 수 있습니다. anon 에게서만 거두면 public 경유로 그대로 열립니다.
--
-- public 에서 거두면 authenticated 도 함께 잃으므로, 바로 다음 줄에서
-- authenticated 에게 되돌려줍니다. 화면은 로그인 사용자로만 돌아가고
-- RLS 와 core.is_admin() 이 그 위에서 다시 판정하므로, 이 되돌림이
-- 화면의 권한 판정을 느슨하게 만들지 않습니다.

revoke all on all functions in schema core      from public, anon;
revoke all on all functions in schema analytics from public, anon;

grant execute on all functions in schema core      to authenticated;
grant execute on all functions in schema analytics to authenticated;

-- 예외 두 개 — authenticated 에게도 주면 안 되는 내부 함수입니다.
-- 바로 위의 무차별 grant 가 이 둘까지 열어버리므로 다시 거둡니다.
--   core.api_key_id_for_hash(text)   sql/26-api.sql — 키 해시로 키를 찾습니다
--   core.import_commit_internal(text) sql/26-api.sql — 인증을 건너뛴 커밋 본체
do $$
begin
  if to_regprocedure('core.api_key_id_for_hash(text)') is not null then
    execute 'revoke all on function core.api_key_id_for_hash(text) from public, anon, authenticated';
  end if;
  if to_regprocedure('core.import_commit_internal(text)') is not null then
    execute 'revoke all on function core.import_commit_internal(text) from public, anon, authenticated';
  end if;
end
$$;

-- ★ 함수에는 §2 같은 자동 차단이 없습니다 — 확인하고 확인한 사실입니다.
--
--   PostgreSQL 17.10 에서 직접 재봤습니다.
--
--     alter default privileges in schema core revoke execute on functions from public;
--     create function core.probe() returns int language sql as $x$ select 1 $x$;
--     select proacl from pg_proc ...;   →  {=X/postgres, postgres=X/...}   ← public 이 그대로
--
--   스키마를 지정한 default privileges 는 PostgreSQL 이 내장 기본값에 **더하기만** 합니다.
--   테이블의 내장 기본값은 "public 에 아무것도 없음" 이라 §2 의 revoke 로 완전히 닫히지만,
--   함수의 내장 기본값은 "public 에 execute" 이고 스키마 단위로는 그것을 뺄 수 없습니다.
--   (스키마를 빼고 데이터베이스 전체에 걸면 지워집니다. 그러나 그러면 Supabase 가
--    나중에 만드는 auth · storage · extensions 의 함수까지 함께 닫혀 위험합니다.)
--
--   그래서 규칙은 하나입니다.
--
--     ★ 함수를 추가하는 SQL 파일을 적용했다면, 그 다음에 이 파일을 다시 실행하세요.
--
--   §4 의 첫 두 줄이 새로 생긴 함수의 public execute 를 걷어내고, 그 다음 두 줄이
--   authenticated 에게 돌려줍니다. 이 파일은 몇 번을 돌려도 같은 결과가 됩니다.
--   sql/README.md 의 실행 순서에서 이 파일이 마지막인 이유입니다.

-- ──────────────────────────────────────────────────────────────
-- §5  anon 에게 되돌려주는 것 — 이 목록이 전부입니다
-- ──────────────────────────────────────────────────────────────
--
-- 전부 security definer 이고, 전부 자기 안에서 호출자를 다시 검사합니다.
-- 실행 권한을 준다고 테이블이 열리지 않습니다.
--
-- 아직 적용하지 않은 파일이 있어도 이 파일이 멈추지 않도록 존재를 확인하고
-- 부여합니다. 없는 함수에 grant 하면 42883 으로 파일 전체가 서 버립니다.

do $$
declare
  -- 함수 시그니처 · 그것을 부르는 곳
  v_fn text[] := array[
    -- ① Vercel Cron — app/api/cron/scan-alerts/route.ts
    --    세션이 없어 core.is_admin() 이 false 입니다. p_secret 을 DB 의
    --    app.cron_secret 과 맞춰 스스로 판정합니다 (sql/20-alert.sql).
    'core.scan_alerts(text)',
    --    같은 라우트가 스캔 직전에 만료 가예약을 풉니다 (lib/atp.ts
    --    releaseExpiredAllocations · sql/23-atp-sales.sql).
    --    ★ 두 시그니처를 함께 적습니다. sql/23 이 인자 없는 것을 drop 하고
    --      p_secret 을 받는 것으로 바꿨습니다(scan_alerts 와 같은 방식). 아직
    --      옛 버전이 남아 있는 데이터베이스에서도 이 파일이 맞게 동작하도록,
    --      존재하는 쪽에만 부여합니다. 없는 쪽은 notice 하나만 남깁니다.
    'core.release_expired_allocations(text)',
    'core.release_expired_allocations()',

    -- ② External API (Inbound) — app/api/v1/** POST · lib/api/*
    --    Bearer 키를 sha256 한 해시로 인증합니다. 세션은 없습니다.
    'core.api_key_authenticate(text)',            -- lib/api/auth.ts  authenticate()
    'core.api_log_write(jsonb)',                  -- lib/api/auth.ts  writeApiLog()
    'core.api_log_find_idempotent(text, text)',   -- lib/api/inbound.ts 멱등 재요청
    'core.api_stage_batch(jsonb)',                -- lib/api/inbound.ts raw 적재
    'core.api_import_commit(text, text)',         -- lib/api/inbound.ts core 반영
    'core.api_scope_for_data_type(text)',         -- lib/api/inbound.ts scope 판정
    --    ★ 검증 재료 — sql/26 §7-2 · lib/api/validation-context.ts
    --      lib/import/repository.ts 의 loadValidationContext 는 core.v_item_master ·
    --      analytics.v_leadtime_gap · analytics.v_raw_schema · core.column_mapping 을
    --      직접 select 합니다. Route Handler 에는 세션이 없어 그 조회가 anon 으로
    --      나가므로 이 파일이 뷰를 닫으면 깨집니다 — 그것도 **조용히** 깨집니다
    --      (오류를 `.data ?? []` 로 삼켜 빈 집합이 되고, lib/import/validate.ts 의
    --      `size > 0` 가드가 UNKNOWN_ITEM · UNKNOWN_SUPPLIER 검사를 건너뜁니다).
    --      그래서 같은 네 곳을 키 해시로 인증한 뒤 대신 읽어주는 함수를 부릅니다.
    --      뷰는 닫힌 채로 두고 이 함수 하나만 엽니다.
    'core.api_validation_context(text, text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_fn loop
    if to_regprocedure(v_sig) is null then
      raise notice 'anon-lockdown: % 가 없어 건너뜁니다 (해당 sql 파일 미적용)', v_sig;
    else
      execute format('grant execute on function %s to anon', v_sig);
    end if;
  end loop;
end
$$;

-- ──────────────────────────────────────────────────────────────
-- §6  확인 — 세 가지가 모두 비어 있어야 합니다
-- ──────────────────────────────────────────────────────────────

-- ① anon 이 읽을 수 있는 테이블 · 뷰. 0 행이어야 합니다.
select 'anon readable table/view' as check, table_schema, table_name, privilege_type
  from information_schema.role_table_grants
 where grantee in ('anon', 'PUBLIC')
   and table_schema in ('core', 'analytics', 'raw')
 order by table_schema, table_name;

-- ② anon 이 실행할 수 있는 함수. §5 의 목록(9개)만 나와야 합니다.
--    api_key_id_for_hash · import_commit_internal · api_target_for_data_type 이
--    여기 보이면 안 됩니다.
select 'anon executable function' as check,
       n.nspname as schema,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('core', 'analytics')
   and has_function_privilege('anon', p.oid, 'execute')
 order by 2, 3;

-- ③ 아직 살아 있는 자동 grant. anon 이 들어간 행이 없어야 합니다.
select 'default privilege' as check,
       pg_get_userbyid(d.defaclrole) as granted_by,
       n.nspname as schema,
       d.defaclobjtype as obj_type,
       d.defaclacl::text as acl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname in ('core', 'analytics', 'raw')
 order by 2, 3, 4;

-- ④ 스키마 문. analytics 는 false, core 는 true 여야 합니다.
select has_schema_privilege('anon', 'core',      'usage') as anon_core_usage,
       has_schema_privilege('anon', 'analytics', 'usage') as anon_analytics_usage,
       has_table_privilege ('anon', 'analytics.v_leadtime_gap', 'select') as anon_leadtime_select;
