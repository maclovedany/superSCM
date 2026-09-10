-- ============================================================
-- 06. 더미 데이터 정리 + AI Agent 대화 저장
--
--   전반부: 5회차 더미 뷰를 "폐기"로 표시합니다 (지우지는 않습니다)
--   후반부: 실습 ⑦ 에서 쓸 대화 저장 테이블과 RLS
--
--   선행: 06-grants-and-lockdown.sql
-- ============================================================


-- ============================================================
-- PART A · 5회차 더미 뷰 폐기 표시
--
--   ★ 바로 drop 하지 않습니다.
--     기존 화면 4개(/dashboard · /analysis/*)가 아직 이 뷰들을 읽고 있어서,
--     지우면 화면이 통째로 죽습니다. 먼저 "쓰지 말라"고 표시하고,
--     화면을 실데이터 뷰로 옮긴 다음 회차에서 지웁니다.
-- ============================================================
do $$
declare v text;
begin
  foreach v in array array[
      'v_stockout_risk', 'v_stockout_kpi', 'v_leadtime_gap',
      'v_usage_profile', 'v_usage_anomaly'
  ] loop
    if exists (select 1 from information_schema.views
                where table_schema='analytics' and table_name=v) then
      execute format(
        'comment on view analytics.%I is %L',
        v,
        '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 '
        '없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · '
        'v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.');
      raise notice '폐기 표시: analytics.%', v;
    end if;
  end loop;
end $$;

-- 화면 이관이 끝나면 다음 회차에서 아래를 실행합니다 (지금은 실행하지 마세요)
--   drop view if exists analytics.v_stockout_risk  cascade;
--   drop view if exists analytics.v_stockout_kpi   cascade;
--   drop view if exists analytics.v_leadtime_gap   cascade;


-- ============================================================
-- PART B · AI Agent 대화 저장 (실습 ⑦)
--
--   ★ 대화 저장은 "부가 기능"입니다.
--     저장이 실패해도 이미 만들어진 답변은 화면에 남아야 합니다.
--     그래서 별도 테이블로 격리하고, 앱에서는 lib/agent/conversation.ts 한 파일만
--     이 테이블을 만집니다. 나머지 lib/agent/* 에는 Supabase 호출이 없습니다.
--
--   ★ 스키마는 완성본(z-superSCM sql/22-agent.sql)과 같은 모양입니다.
--     키가 id(uuid) 가 아니라 conversation_id(text) 인 것이 중요합니다.
--     완성본이 이미 적용된 프로젝트에서 다른 모양으로 만들려 하면
--     create table if not exists 가 조용히 건너뛰고,
--     정책이 없는 컬럼을 참조해 ERROR 42703 이 납니다.
-- ============================================================

-- ------------------------------------------------------------
-- 이미 다른 구조로 존재하면 조용히 넘어가지 말고 여기서 멈춥니다
-- ------------------------------------------------------------
do $$
declare k text;
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'core' and table_name = 'agent_conversation') then
    select string_agg(column_name, ',' order by ordinal_position) into k
      from information_schema.columns
     where table_schema = 'core' and table_name = 'agent_conversation'
       and column_name in ('conversation_id', 'id');
    if coalesce(k, '') not like '%conversation_id%' then
      raise exception
        'core.agent_conversation 이 다른 구조로 이미 있습니다 (키 컬럼: %). '
        '기존 대화 데이터가 필요 없으면 아래를 먼저 실행하세요: '
        'drop table if exists core.agent_message cascade; '
        'drop table if exists core.agent_conversation cascade;', coalesce(k, '없음');
    end if;
    raise notice 'core.agent_conversation 이 이미 있습니다 — 그대로 사용합니다';
  end if;
end $$;

create table if not exists core.agent_conversation (
    conversation_id text        primary key,
    user_id         uuid        not null references auth.users(id) on delete cascade,
    user_email      text,
    title           text,
    started_at      timestamptz not null default now(),
    last_at         timestamptz not null default now()
);

create table if not exists core.agent_message (
    id              bigserial   primary key,
    conversation_id text        not null
                      references core.agent_conversation(conversation_id) on delete cascade,
    user_id         uuid        not null references auth.users(id) on delete cascade,
    role            text        not null check (role in ('user', 'assistant', 'tool')),
    content         text        not null default '',
    answer          jsonb,      -- Structured Output 원본 (AgentAnswer)
    tool_trace      jsonb,      -- [{name,args,ok,ms,reason}]
    usage           jsonb,      -- {promptTokens, completionTokens, totalTokens}
    guardrail       jsonb,      -- {passed, regenerated, blockedNumbers[]}
    created_at      timestamptz not null default now()
);

create index if not exists ix_agent_conv_user on core.agent_conversation (user_id, last_at desc);
create index if not exists ix_agent_msg_conv  on core.agent_message (conversation_id, id);
create index if not exists ix_agent_msg_time  on core.agent_message (created_at desc);

-- ------------------------------------------------------------
-- RLS — fail-closed. 정책에 없는 동작은 전부 거절됩니다.
--
--   ★ 메시지 정책이 대화 테이블을 다시 조회하지 않습니다.
--     agent_message 에 user_id 를 직접 두었기 때문입니다.
--     서브쿼리로 쓰면 정책 안에서 컬럼 이름이 겹쳐(conversation_id)
--     조건이 항상 참이 되는 사고가 납니다.
-- ------------------------------------------------------------
alter table core.agent_conversation enable row level security;
alter table core.agent_message      enable row level security;

drop policy if exists conv_select_own   on core.agent_conversation;
drop policy if exists conv_insert_own   on core.agent_conversation;
drop policy if exists conv_update_own   on core.agent_conversation;
drop policy if exists conv_select_admin on core.agent_conversation;
drop policy if exists msg_select_own    on core.agent_message;
drop policy if exists msg_insert_own    on core.agent_message;
drop policy if exists msg_select_admin  on core.agent_message;

create policy conv_select_own on core.agent_conversation
    for select to authenticated using (user_id = auth.uid());
create policy conv_insert_own on core.agent_conversation
    for insert to authenticated with check (user_id = auth.uid());
create policy conv_update_own on core.agent_conversation
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy msg_select_own on core.agent_message
    for select to authenticated using (user_id = auth.uid());
create policy msg_insert_own on core.agent_message
    for insert to authenticated with check (user_id = auth.uid());

-- 관리자는 감사 목적으로 전체 조회 (5회차 STEP 2 의 core.is_admin() 재사용)
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'core' and p.proname = 'is_admin') then
    execute 'create policy conv_select_admin on core.agent_conversation
               for select to authenticated using (core.is_admin())';
    execute 'create policy msg_select_admin on core.agent_message
               for select to authenticated using (core.is_admin())';
    raise notice '관리자 감사 정책 생성 완료';
  else
    raise notice 'core.is_admin() 이 없습니다 — 관리자 감사 정책은 건너뜁니다';
  end if;
end $$;

grant select, insert, update on core.agent_conversation to authenticated;
grant select, insert          on core.agent_message      to authenticated;
grant usage, select on all sequences in schema core to authenticated;
revoke all on core.agent_conversation from anon, public;
revoke all on core.agent_message      from anon, public;


-- ============================================================
-- 확인
-- ============================================================
select tablename,
       rowsecurity as rls_켜짐,
       (select count(*) from pg_policies p
         where p.schemaname = 'core' and p.tablename = t.tablename) as 정책수
from pg_tables t
where schemaname = 'core' and tablename like 'agent%';
-- 기대: rls_켜짐 = true · 정책수 conversation 4 · message 3 (is_admin 있을 때)
--       is_admin() 이 없으면 conversation 3 · message 2

-- 폐기 표시 확인
select table_name, obj_description(('analytics.'||table_name)::regclass, 'pg_class') as 주석
from information_schema.views
where table_schema = 'analytics'
  and table_name in ('v_stockout_risk','v_stockout_kpi','v_leadtime_gap');
