-- ──────────────────────────────────────────────────────────────
-- STEP 16 · AI Agent — 대화 기록
--
-- renew.prd 26장
--   "User → LLM Intent → Tool Calling → Backend Function
--     → Structured Result → LLM Explanation"                                   (26.1)
--   "Tool 반환값에 없는 수치는 응답에 포함 금지. 후처리 검증으로 수치 일치 확인"      (26.3)
--   "판단 결과 · 근거 · 데이터 기준시각 · Risk · Recommended Action"              (26.4)
-- renew.prd 31.4  "LLM 실패가 SCM 계산 자체를 중단시키면 안 된다"
--
-- ★ 계산은 하나도 하지 않습니다. 숫자는 전부 STEP 9~14 의 뷰가 이미 만들었고,
--   AI 툴은 화면이 쓰는 lib 함수를 그대로 부릅니다 (renew.prd 32).
--   이 파일이 만드는 것은 "무엇을 묻고 무엇을 답했나" 의 기록뿐입니다.
--
-- 여기서 만드는 것
--   core       agent_conversation      대화 머리 (한 사람의 한 대화)
--   core       agent_message           대화 한 줄 (질문 · 답변 · 툴 호출 기록)
--   core       save_agent_turn()       질문과 답변을 한 트랜잭션으로 저장
--   analytics  v_agent_usage           일별 호출 수 · 평균 툴 수 · Guardrail 실패 수 (관리자용)
--
-- 먼저 실행할 파일
--   sql/03-auth.sql   core.app_user · core.is_admin()
--   (그 밖에는 없습니다. 이 파일은 다른 STEP 의 테이블을 참조하지 않습니다.)
--
-- 다시 실행해도 안전합니다 — create table if not exists · create or replace ·
-- drop policy if exists 로만 씁니다. drop view 가 한 줄도 없어서 sql/15~21 의
-- cascade 재실행 규칙(sql/README.md §2)과 무관합니다. 혼자 다시 실행해도 되고,
-- 앞 파일을 다시 실행했다고 해서 이 파일을 다시 돌릴 필요도 없습니다.
--
-- ★ error.md #11 — RETURNS TABLE 의 컬럼 이름은 함수 안에서 변수가 됩니다.
--   본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 테이블 ══════════════════════════════════════════════════
--
-- 대화 식별자를 uuid 가 아니라 text 로 두는 이유는, 화면이 ?c=... 로 들고 다니는
-- 값이라 사람이 눈으로 대조할 수 있어야 하기 때문입니다 (앱은 'conv_<uuid>' 를 씁니다).

create table if not exists core.agent_conversation (
  conversation_id text        primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  user_email      text,
  title           text,
  started_at      timestamptz not null default now(),
  last_at         timestamptz not null default now()
);

create index if not exists agent_conversation_user_idx
  on core.agent_conversation (user_id, last_at desc);

-- 한 줄 = 질문 하나 또는 답변 하나.
--
--   content      사람이 읽는 본문. 질문은 질문 그대로, 답변은 answer.answer 문장
--   answer       구조화 응답 전체 (renew.prd 26.4). 화면이 근거 타일·Risk 를 여기서 그립니다
--   tool_trace   [{ name, args, ok, ms, reason }] — 어떤 툴을 몇 ms 만에 불렀나
--   usage        토큰 사용량
--   guardrail    { ok, offending[], regenerated, checked } — 수치 검증 결과 (renew.prd 26.3)
--
-- role 에 'tool' 을 허용해 둡니다. 지금 화면은 질문·답변만 저장하지만, 툴 호출을 한 줄씩
-- 남기고 싶어질 때 제약을 다시 손대지 않으려는 것입니다.
create table if not exists core.agent_message (
  id              bigserial   primary key,
  conversation_id text        not null references core.agent_conversation(conversation_id)
                                on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant', 'tool')),
  content         text        not null default '',
  answer          jsonb,
  tool_trace      jsonb,
  usage           jsonb,
  guardrail       jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists agent_message_conversation_idx
  on core.agent_message (conversation_id, id);

create index if not exists agent_message_created_idx
  on core.agent_message (created_at desc);

-- ══ 2. 저장 함수 ═══════════════════════════════════════════════
--
-- 왜 함수인가
--   ① 대화 머리 · 질문 · 답변 세 줄을 한 트랜잭션으로 남깁니다. 중간에 끊기면
--      "질문은 있는데 답이 없는" 대화가 남습니다.
--   ② user_id 를 화면이 보낸 값이 아니라 auth.uid() 로 채웁니다. 남의 이름으로
--      대화를 심을 수 없어야 합니다 (renew.prd 31.1).
--
-- 관리자 전용이 아닙니다. 로그인한 사용자 누구나 자기 대화를 저장합니다 (renew.prd 4.3).
-- 그래서 첫 줄이 core.is_admin() 이 아니라 auth.uid() 확인입니다.
--
-- 반환 컬럼을 (ok, message) 둘로 둔 것은 일부러입니다. conversation_id 를 반환 컬럼으로
-- 두면 함수 안에서 그 이름이 변수가 되어 테이블 컬럼과 겹칩니다 (error.md #11).
-- 저장한 대화 식별자는 부른 쪽이 이미 알고 있습니다.
create or replace function core.save_agent_turn(
  p_conversation_id text,
  p_title           text,
  p_question        text,
  p_answer          jsonb,
  p_tool_trace      jsonb,
  p_usage           jsonb,
  p_guardrail       jsonb
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_body    text;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text;
    return;
  end if;

  if p_conversation_id is null or btrim(p_conversation_id) = '' then
    return query select false, '대화 식별자가 없습니다'::text;
    return;
  end if;

  if p_question is null or btrim(p_question) = '' then
    return query select false, '질문이 비어 있습니다'::text;
    return;
  end if;

  select au.email into v_email from core.app_user au where au.user_id = v_uid;

  -- 대화 머리. 이미 있으면 마지막 시각만 밀어 줍니다.
  -- 제목은 첫 질문으로 정해지므로 덮어쓰지 않습니다.
  insert into core.agent_conversation as c
         (conversation_id, user_id, user_email, title, started_at, last_at)
  values (p_conversation_id, v_uid, v_email, nullif(btrim(coalesce(p_title, '')), ''), now(), now())
  on conflict (conversation_id) do update
     set last_at    = now(),
         user_email = coalesce(c.user_email, excluded.user_email),
         title      = coalesce(c.title, excluded.title)
   where c.user_id = v_uid;

  -- 남의 대화에 끼워 넣으려 한 경우입니다. where 절이 막아 아무 행도 바뀌지 않습니다.
  if not exists (select 1
                   from core.agent_conversation c2
                  where c2.conversation_id = p_conversation_id
                    and c2.user_id = v_uid) then
    return query select false, '이 대화에 저장할 수 없습니다'::text;
    return;
  end if;

  insert into core.agent_message (conversation_id, user_id, role, content)
  values (p_conversation_id, v_uid, 'user', p_question);

  -- 답변 본문은 구조화 응답의 answer 를 그대로 씁니다. 없으면 산출 불가 사유를 남깁니다.
  v_body := coalesce(nullif(btrim(coalesce(p_answer ->> 'answer', '')), ''),
                     nullif(btrim(coalesce(p_answer ->> 'cannot_answer_reason', '')), ''),
                     '산출할 수 없습니다.');

  insert into core.agent_message
         (conversation_id, user_id, role, content, answer, tool_trace, usage, guardrail)
  values (p_conversation_id, v_uid, 'assistant', v_body,
          p_answer, p_tool_trace, p_usage, p_guardrail);

  return query select true, '저장했습니다'::text;
end;
$$;

-- ══ 3. analytics 뷰 — 사용 현황 (관리자) ════════════════════════
--
-- 개인의 질문 문장은 담지 않습니다. 날짜별 집계만 냅니다.
--
-- ★ 이 프로젝트의 analytics 뷰는 소유자 권한으로 돌기 때문에 밑에 걸어 둔 RLS 가
--   적용되지 않습니다. 그래서 뷰 안에서 core.is_admin() 으로 직접 막습니다.
--   관리자가 아니면 0행입니다. 대화 본문은 앱이 core 테이블을 직접 읽어(RLS 적용)
--   본인 것만 봅니다.
--
-- 평균 툴 수는 double precision 이 되므로 numeric 으로 캐스팅한 뒤 round 합니다
-- (공통규칙 12 — round(double precision, int) 는 없습니다).
create or replace view analytics.v_agent_usage as
select date_trunc('day', m.created_at)::date          as day,
       count(*)                                       as n_answers,
       count(distinct m.conversation_id)              as n_conversations,
       count(distinct m.user_id)                      as n_users,
       round(avg(coalesce(jsonb_array_length(
              case when jsonb_typeof(m.tool_trace) = 'array' then m.tool_trace else '[]'::jsonb end
            ), 0))::numeric, 2)                       as avg_tools,
       count(*) filter (where m.guardrail ->> 'ok' = 'false')        as n_guardrail_failed,
       count(*) filter (where m.guardrail ->> 'regenerated' = 'true') as n_regenerated,
       count(*) filter (where m.answer ->> 'cannot_answer' = 'true')  as n_cannot_answer,
       sum(coalesce((m.usage ->> 'totalTokens')::numeric, 0))         as total_tokens
  from core.agent_message m
 where m.role = 'assistant'
   and core.is_admin()
 group by 1;

-- ══ 4. 권한 ════════════════════════════════════════════════════
--
-- 쓰기는 위 함수 하나로만 합니다. 그래서 authenticated 에게 select 만 줍니다 —
-- 직접 insert 할 수 있으면 남의 이름으로 대화를 심을 길이 생깁니다.

grant select on core.agent_conversation to authenticated;
grant select on core.agent_message      to authenticated;
revoke all on core.agent_conversation from anon;
revoke all on core.agent_message      from anon;

alter table core.agent_conversation enable row level security;
alter table core.agent_message      enable row level security;

-- 본인 대화만 봅니다. 관리자는 전부 볼 수 있습니다 (renew.prd 4.2 의 System Log 조회).
drop policy if exists agent_conversation_read_own on core.agent_conversation;
create policy agent_conversation_read_own on core.agent_conversation
  for select to authenticated
  using (user_id = auth.uid() or core.is_admin());

drop policy if exists agent_message_read_own on core.agent_message;
create policy agent_message_read_own on core.agent_message
  for select to authenticated
  using (user_id = auth.uid() or core.is_admin());

grant select on analytics.v_agent_usage to authenticated;
revoke all on analytics.v_agent_usage from anon;

revoke all on function core.save_agent_turn(text, text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function core.save_agent_turn(text, text, text, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

-- ══ 5. 확인 ════════════════════════════════════════════════════

-- 테이블이 만들어졌는가
select table_schema, table_name
  from information_schema.tables
 where table_schema = 'core'
   and table_name in ('agent_conversation', 'agent_message')
 order by table_name;

-- 정책 두 개가 붙었는가
select schemaname, tablename, policyname, cmd
  from pg_policies
 where schemaname = 'core'
   and tablename in ('agent_conversation', 'agent_message')
 order by tablename, policyname;

-- 내 대화 (로그인 세션에서 실행하세요. anon 으로는 auth.uid() 가 null 이라 0행입니다)
select c.conversation_id, c.title, c.started_at, c.last_at
  from core.agent_conversation c
 order by c.last_at desc
 limit 10;

select m.id, m.conversation_id, m.role, left(m.content, 60) as content,
       m.answer ->> 'risk'          as risk,
       m.guardrail ->> 'ok'         as guardrail_ok,
       jsonb_array_length(case when jsonb_typeof(m.tool_trace) = 'array'
                               then m.tool_trace else '[]'::jsonb end) as n_tools,
       m.created_at
  from core.agent_message m
 order by m.id desc
 limit 20;

-- 사용 현황 (관리자 세션에서만 행이 나옵니다)
select * from analytics.v_agent_usage order by day desc limit 30;

-- 함수를 직접 시험해 보려면 (로그인 세션에서)
--   select * from core.save_agent_turn(
--     'conv_test', '시험 질문', 'ITEM012 왜 700대 발주해야 해?',
--     '{"answer":"시험","cannot_answer":false}'::jsonb,
--     '[{"name":"calcOrderQuantity","ok":true,"ms":12}]'::jsonb,
--     '{"totalTokens":150}'::jsonb,
--     '{"ok":true,"regenerated":false,"checked":3}'::jsonb);
