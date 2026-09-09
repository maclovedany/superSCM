-- STEP 16 ⑦ 대화 저장과 RLS — 6회차 슬라이드 64 · 75 (프롬프트 7)
--
-- 수업 MVP 는 브라우저 상태만으로도 굴러갑니다. 그러나 운영에서는 **누가 어떤 질문을 했고
-- 어떤 Tool 과 데이터로 답했는지** 가 감사 기록입니다. 일반 채팅 기록과 다른 점이 그것입니다.
--
-- 여기서 만드는 것
--   core.agent_conversation   대화 한 건 (사용자별)
--   core.agent_message        질문 · 답변 · Tool Trace · Guardrail 결과 · 토큰 사용량
--
-- RLS
--   일반 사용자는 **본인 대화만** 읽고 씁니다. 관리자는 감사 목적으로 전체를 읽습니다.
--   analytics 뷰를 두지 않는 이유: 이 프로젝트의 뷰는 소유자 권한으로 돌아 그 밑의 RLS 가
--   적용되지 않습니다. 대화는 본인 것만 보여야 하므로 화면이 core 테이블을 직접 읽습니다.
--
-- ★ 대화 저장 실패가 이미 만들어진 답변을 없애면 안 됩니다. 앱(lib/agent/conversation.ts)이
--   저장 실패를 오류로 던지지 않고 answer 를 그대로 보여 줍니다.
--
-- 다시 실행해도 안전합니다.


-- ══ 0. 옛 모양이 남아 있으면 옆으로 밀어 둡니다 ═══════════════
--
-- 겪은 일 (error.md #12) — 이름이 같고 컬럼이 다른 `core.agent_conversation` 이 이미 있는
-- 데이터베이스에서 이 파일을 돌리면 `create table if not exists` 가 조용히 건너뛰고, 그다음
-- 인덱스가 `column "last_message_at" does not exist` 로 죽습니다. 원인이 드러나지 않습니다.
--
-- ★ 지우지 않습니다. 이름 뒤에 시각을 붙여 옮겨 둡니다. 옛 대화가 남아 있을 수 있고,
--   지운 것은 되돌릴 수 없기 때문입니다. 확인한 뒤 필요 없으면 그때 사람이 지웁니다.

do $legacy$
declare
  v_stamp text := to_char(now(), 'YYYYMMDDHH24MI');
  v_kind  "char";
  v_ok    boolean;
  v_name  text;
begin
  for v_name in select unnest(array['agent_conversation', 'agent_message']) loop
    select c.relkind into v_kind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'core' and c.relname = v_name;

    if v_kind is null then
      continue;  -- 없으면 새로 만들면 됩니다
    end if;

    -- 새 모양인지 확인합니다. 기준 컬럼은 각각 last_message_at · token_usage 입니다.
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'core'
         and table_name   = v_name
         and column_name  = case v_name when 'agent_conversation' then 'last_message_at' else 'token_usage' end
    ) into v_ok;

    if v_ok then
      continue;  -- 이미 이 파일이 만든 표입니다
    end if;

    -- 옛 표(또는 뷰)를 옮깁니다. 딸린 인덱스 이름도 함께 비워 줘야 아래에서 새로 만들 수 있습니다.
    if v_kind = 'v' then
      execute format('alter view core.%I rename to %I', v_name, v_name || '_legacy_' || v_stamp);
    else
      execute format('alter table core.%I rename to %I', v_name, v_name || '_legacy_' || v_stamp);
      execute format('alter index if exists core.%I rename to %I',
                     v_name || '_user_idx', v_name || '_user_idx_legacy_' || v_stamp);
      execute format('alter index if exists core.%I rename to %I',
                     v_name || '_conversation_idx', v_name || '_conversation_idx_legacy_' || v_stamp);
      execute format('alter index if exists core.%I rename to %I',
                     v_name || '_created_idx', v_name || '_created_idx_legacy_' || v_stamp);
    end if;

    raise notice '옛 core.% 를 core.%_legacy_% 로 옮겼습니다. 내용을 확인한 뒤 필요 없으면 지우세요.',
                 v_name, v_name, v_stamp;
  end loop;
end
$legacy$;


-- ══ 1. 표 ══════════════════════════════════════════════════════

create table if not exists core.agent_conversation (
  conversation_id  uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null default '',
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now()
);

create index if not exists agent_conversation_user_idx
  on core.agent_conversation (user_id, last_message_at desc);

create table if not exists core.agent_message (
  message_id       uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references core.agent_conversation(conversation_id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  question         text not null,
  -- 답변은 schema.ts 의 계약을 그대로 담습니다. 화면이 다시 파싱하지 않습니다.
  answer           jsonb,
  tool_trace       jsonb not null default '[]'::jsonb,
  guardrail        jsonb,
  token_usage      jsonb,
  error            text,
  created_at       timestamptz not null default now()
);

create index if not exists agent_message_conversation_idx
  on core.agent_message (conversation_id, created_at);


-- ══ 2. RLS ═════════════════════════════════════════════════════

alter table core.agent_conversation enable row level security;
alter table core.agent_message      enable row level security;

do $agent_rls$
begin
  -- 다시 실행해도 안전하도록 먼저 지웁니다.
  drop policy if exists agent_conversation_owner_select on core.agent_conversation;
  drop policy if exists agent_conversation_owner_write  on core.agent_conversation;
  drop policy if exists agent_message_owner_select      on core.agent_message;
  drop policy if exists agent_message_owner_write       on core.agent_message;

  create policy agent_conversation_owner_select on core.agent_conversation
    for select to authenticated
    using (user_id = auth.uid() or core.is_admin());

  create policy agent_conversation_owner_write on core.agent_conversation
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

  create policy agent_message_owner_select on core.agent_message
    for select to authenticated
    using (user_id = auth.uid() or core.is_admin());

  create policy agent_message_owner_write on core.agent_message
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
end
$agent_rls$;


-- ══ 3. 권한 ════════════════════════════════════════════════════

grant select, insert, update, delete on core.agent_conversation to authenticated;
grant select, insert, update, delete on core.agent_message      to authenticated;
revoke all on core.agent_conversation from anon;
revoke all on core.agent_message      from anon;

comment on table core.agent_conversation is
  'STEP 16 — AI Agent 대화. 본인 대화만 조회·기록하고 관리자는 감사 목적으로 전체 조회';
comment on table core.agent_message is
  'STEP 16 — 질문 · 답변(JSON 계약) · Tool Trace · Guardrail 결과. 저장 실패가 답변을 없애지 않습니다';


-- ══ 4. 확인 (읽기 전용) ════════════════════════════════════════

select table_name, count(*) as n_columns
  from information_schema.columns
 where table_schema = 'core'
   and table_name in ('agent_conversation', 'agent_message')
 group by table_name
 order by table_name;
