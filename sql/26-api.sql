-- ──────────────────────────────────────────────────────────────
-- STEP 19 · External API — Inbound · Outbound · API Key
--
-- renew.prd 9장 (9.1 Inbound · 9.2 Outbound · 9.3 API Key) · 8.3 (Validation) · 31.1 (보안)
--
-- 여기서 만드는 것
--   core       api_key                     외부 연동 키. **해시만** 보관합니다
--   core       api_log                     호출 기록 + 멱등 응답 보관
--   core       api_anon_stat               인증되지 않은 호출의 일별 건수 (행이 아니라 카운터)
--   core       api_scope_for_data_type()   데이터 종류 → 필요한 scope
--   core       api_target_for_data_type()  ★ 데이터 종류 → target_table · period_field · key_fields (내부 전용)
--   core       api_validation_context()    ★ 검증 재료 (마스터 · 대상 컬럼 · 저장된 매핑). anon 실행 허용
--   core       api_key_id_for_hash()       해시 → key_id (살아 있는 키만). 내부 전용
--   core       api_key_authenticate()      anon 실행 허용. Route Handler 가 부릅니다
--   core       api_key_create/revoke()     관리자 전용
--   core       api_log_write()             anon 실행 허용 · 인증된 호출만 행을 만듭니다
--   core       api_log_find_idempotent()   anon 실행 허용 · 같은 Idempotency-Key 의 지난 응답
--   core       import_commit_internal()    ★ sql/09 의 본문. 권한 검사 없음 · 아무에게도 execute 없음
--   core       import_commit()             ★ sql/09 재정의 — is_admin 검사 후 internal 호출
--   core       api_import_commit()         anon 실행 허용 · 키 해시와 배치 소유자를 확인 후 internal 호출
--   core       api_stage_batch()           anon 실행 허용 · 적재 대상은 data_type 이 정합니다 (호출자가 아니라)
--   analytics  v_api_key · v_api_log · v_api_kpi   (전부 관리자에게만 행이 나옵니다)
--   권한       service_role 에 Outbound(GET)가 읽는 뷰 9개 + ATP 함수 1개 (§10-2)
--
-- 먼저 실행할 파일
--   sql/25-python-models.sql 까지 (특히 sql/03-auth.sql · sql/08-import.sql · sql/09-import-commit.sql)
--
-- ★ sql/09-import-commit.sql 의 core.import_commit 최종 정의는 이 파일에 있습니다.
--   sql/09 를 나중에 다시 실행하면 관리자 게이트가 본문 안으로 되돌아가므로,
--   sql/09 를 재실행했다면 이 파일도 다시 실행하세요.
--
-- ★ 왜 anon 에 execute 를 주는가
--   Route Handler(app/api/v1/*)에는 로그인 세션이 없습니다. 쿠키가 없으므로
--   Supabase 클라이언트는 publishable 키만 들고 anon 으로 접속합니다.
--   그래서 인증을 DB 함수가 대신 합니다 — 함수가 인자로 받은 **해시**를 검사하고,
--   검사에 성공한 만큼만 일을 합니다.
--
-- ★ anon 이 부를 수 있는 함수(authenticate · log_write · log_find_idempotent ·
--   stage_batch · api_import_commit)는 인자로 받은 해시를 대조하는 것 말고는
--   아무 것도 하지 않습니다. 다음 두 가지를 지킵니다.
--     · key_id 만으로는 아무 것도 되지 않습니다. key_id 는 관리자 화면과 호출 로그에
--       그대로 보이는 값이라 비밀이 아닙니다. 반드시 key_hash 를 함께 받습니다.
--     · 실패했을 때 integration_name · scope 를 돌려주지 않습니다.
--
-- ★ error.md #20 — 3값 논리로 게이트가 열리지 않게 합니다.
--   "키를 찾았는가" 를 `v_key_id is null` 하나로만 판정합니다.
--   조회 조건(active is true · revoked_at is null · expires_at 비교)이 하나라도
--   NULL 이면 행이 나오지 않으므로 v_key_id 는 NULL 로 남고, 그 갈래는 항상 거부입니다.
--   NULL 이 통과하는 길이 없습니다.
--
-- ★ error.md #11 — RETURNS TABLE 의 컬럼 이름은 함수 안에서 변수가 됩니다.
--   본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다.
--
-- ★ error.md #22 — 파일 끝 확인 블록에는 읽기 전용 select 만 둡니다.
--   관리자 전용 함수를 파일 안에서 부르지 않습니다.
--
-- 다시 실행해도 안전합니다 — create table if not exists · create or replace ·
-- drop policy if exists 로만 씁니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 테이블 ══════════════════════════════════════════════════
--
-- renew.prd 9.3 · 31.1 — "원문은 생성 시 한 번만 노출한다. 이후 해시만 보관한다."
--
-- key_hash   sha256 hex 64자. 원문은 어디에도 저장하지 않습니다
-- key_prefix 원문 앞 8자. 관리자가 "어느 키인지" 눈으로 대조하는 용도입니다.
--            8자만으로는 32바이트 난수를 되돌릴 수 없습니다

create table if not exists core.api_key (
  key_id           text primary key,
  integration_name text not null,
  key_hash         text not null unique,
  key_prefix       text not null,
  scope            text[] not null default '{}',
  active           boolean not null default true,
  created_by       uuid references auth.users(id) on delete set null,
  created_email    text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  last_used_at     timestamptz,
  revoked_at       timestamptz
);

comment on table core.api_key is
  'renew.prd 9.3 — 외부 연동 키. 원문은 저장하지 않습니다. key_hash 는 sha256 hex';
comment on column core.api_key.key_hash is
  '원문의 sha256 hex. 원문은 생성 시 1회만 노출하고 어디에도 남기지 않습니다';

create index if not exists api_key_active_idx on core.api_key(active, revoked_at);

-- 호출 기록. 멱등 재요청에 돌려줄 응답도 여기 둡니다 (renew.prd 9.1 "멱등성").
--
-- 응답 본문을 로그에 담는 것이므로, **원문 키는 절대 이 안에 들어가지 않습니다.**
-- 앱은 응답 객체만 넣습니다 (batch_id · received · accepted · rejected · errors).
create table if not exists core.api_log (
  id              bigserial primary key,
  key_id          text references core.api_key(key_id) on delete set null,
  method          text,
  path            text,
  status          int,
  duration_ms     int,
  received        int,
  accepted        int,
  rejected        int,
  batch_id        text,
  ip              text,
  idempotency_key text,
  response        jsonb,
  at              timestamptz not null default now()
);

comment on table core.api_log is 'renew.prd 9 — External API 호출 기록. 원문 키를 담지 않습니다';

create index if not exists api_log_at_idx  on core.api_log(at desc);
create index if not exists api_log_idem_idx on core.api_log(key_id, idempotency_key)
  where idempotency_key is not null;

-- 인증되지 않은 호출은 **행이 아니라 숫자로** 셉니다 (리뷰 Important 6).
--
-- core.api_log_write 에는 anon 실행 권한이 있어야 합니다 — 401 을 낸 요청도 기록해야
-- "연동이 조용히 죽어 있다" 를 알아챌 수 있기 때문입니다. 그런데 인증되지 않은 호출마다
-- core.api_log 에 행을 하나씩 넣으면, 아무나 그 테이블을 무한히 키우고
-- analytics.v_api_kpi 의 오늘 수치를 마음대로 흔들 수 있습니다.
--
-- 그래서 인증되지 않은 호출은 (날짜, 상태코드) 한 칸의 카운터만 올립니다.
-- path 를 키에 넣지 않는 이유는 path 가 호출자가 정하는 값이라 행 수가 다시 무한해지기
-- 때문입니다. 하루에 몇 행이면 충분합니다 — 알고 싶은 것은 "오늘 인증 실패가 몇 건인가" 뿐입니다.
create table if not exists core.api_anon_stat (
  day    date not null,
  status int  not null,
  n      bigint not null default 0,
  primary key (day, status)
);

comment on table core.api_anon_stat is
  '인증되지 않은 API 호출의 일별 건수. 상태코드를 아는 값 14종 + 기타(0) 으로 접으므로 하루 최대 15행입니다';

-- ══ 2. scope 매핑 ══════════════════════════════════════════════
--
-- renew.prd 9.3 의 scope 6종.
-- 라우트가 요구하는 scope 를 앱이 정하지만, 적재 함수도 같은 표를 보고 한 번 더 막습니다.
-- 앱이 실수로 scope 검사를 빠뜨려도 DB 에서 걸립니다.

create or replace function core.api_scope_for_data_type(p_data_type text)
returns text
language sql
immutable
as $$
  select case p_data_type
    when 'DEMAND'          then 'demand:write'
    when 'EVENT'           then 'demand:write'
    when 'SALES_ORDER'     then 'demand:write'
    when 'INVENTORY'       then 'inventory:write'
    when 'ITEM_MASTER'     then 'inventory:write'
    when 'SUPPLIER_MASTER' then 'inventory:write'
    when 'PURCHASE_ORDER'  then 'purchase_order:write'
    when 'RECEIPT'         then 'purchase_order:write'
    else null
  end;
$$;

comment on function core.api_scope_for_data_type(text) is
  'renew.prd 9.3 — 데이터 종류가 요구하는 scope. 모르는 종류는 null 이라 항상 거부됩니다';

-- ══ 2-2. 데이터 종류 → 적재 대상 ★ ═════════════════════════════
--
-- ★ 왜 이 표가 SQL 안에 있어야 하는가 (리뷰 Critical 1)
--
--   권한은 data_type 으로 검사하는데 쓰기 대상을 호출자가 정하게 두면, 검사와 대상이
--   따로 놉니다. core 스키마는 PostgREST 에 노출되어 있고 api_stage_batch 에는
--   anon 실행 권한이 있으므로, demand:write 키 하나만 가진 호출자가
--   data_type='DEMAND' (검사 통과) · target_table='raw.item_master' 로 RPC 를 직접 불러
--   품목 마스터에 쓸 수 있었습니다. mode='replace' 에 넓은 기간을 주면
--   import_commit_internal 의 `delete from raw.%I where %I between …` 이 테이블을 비웁니다.
--   %I 인용이 SQL 주입은 막지만, 파괴적 행위에는 주입이 필요하지 않습니다.
--
--   그래서 target_table · period_field · key_fields 를 **전부 data_type 에서 도출**합니다.
--   호출자가 p 에 같은 이름의 값을 넣어도 무시합니다.
--
-- ★ 이 표는 lib/import/schema.ts 의 TABLE_SPECS 와 같아야 합니다.
--   `lib/api/schema-parity.test.ts` 가 이 파일을 읽어 두 표를 대조합니다.
--   한쪽만 고치면 그 테스트가 깨집니다.

create or replace function core.api_target_for_data_type(p_data_type text)
returns table (target_table text, period_field text, key_fields text[])
language sql
immutable
as $$
  select t.target_table, t.period_field, t.key_fields
    from (values
      ('DEMAND',          'raw.usage_history',   'use_date',               array['item_id','use_date']),
      ('INVENTORY',       'raw.inventory',       'snapshot_date',          array['item_id','warehouse','snapshot_date']),
      ('PURCHASE_ORDER',  'raw.purchase_order',  'order_date',             array['po_no']),
      ('RECEIPT',         'raw.goods_receipt',   'warehouse_receipt_date', array['po_no']),
      ('ITEM_MASTER',     'raw.item_master',     null,                     array['item_id']),
      ('SUPPLIER_MASTER', 'raw.supplier_master', null,                     array['supplier_id']),
      ('EVENT',           'raw.business_event',  'period_start',           array['event_id']),
      ('SALES_ORDER',     'raw.sales_order',     'due_date',               array['so_no'])
    ) as t(data_type, target_table, period_field, key_fields)
   where t.data_type = p_data_type;
$$;

comment on function core.api_target_for_data_type(text) is
  '★ renew.prd 9.1 — 데이터 종류가 정하는 적재 대상. 호출자가 준 target_table 을 쓰지 않기 위한 표입니다. lib/import/schema.ts 의 TABLE_SPECS 와 같아야 합니다';

-- ══ 3. 해시 → key_id ═══════════════════════════════════════════
--
-- ★ 이 파일의 모든 인증이 이 함수 하나를 지납니다.
--
--   살아 있는 키가 아니면 **NULL** 을 돌려줍니다. 호출부는 `is null` 하나만 봅니다.
--   조건이 하나라도 NULL 이면 where 절이 행을 내주지 않으므로 결과는 NULL 입니다.
--   즉 NULL 이 "통과" 로 해석되는 길이 없습니다 (error.md #20).
--
--   anon 에게 execute 를 주지 않습니다. 이 함수를 직접 부를 수 있으면
--   "이 해시가 유효한가" 를 무제한으로 물어볼 수 있기 때문입니다.
--   같은 파일의 security definer 함수들만 부릅니다.

create or replace function core.api_key_id_for_hash(p_hash text)
returns text
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_key_id text;
begin
  -- sha256 hex 가 아니면 조회하지 않습니다.
  if p_hash is null or length(p_hash) <> 64 then
    return null;
  end if;

  select k.key_id
    into v_key_id
    from core.api_key k
   where k.key_hash    = p_hash
     and k.active      is true
     and k.revoked_at  is null
     and (k.expires_at is null or k.expires_at > now());

  return v_key_id;   -- 못 찾으면 NULL. 호출부는 NULL 을 거부로 봅니다
end;
$$;

revoke all on function core.api_key_id_for_hash(text) from public, anon, authenticated;

-- ══ 4. 인증 ════════════════════════════════════════════════════
--
-- Route Handler 가 Bearer 토큰을 sha256 해서 이 함수에 넘깁니다.
--
-- ok 는 not null 입니다. 실패한 경우 key_id · integration_name · scope 는 전부 NULL 이라
-- 호출부가 ok 를 안 보고 scope 만 읽어도 아무 권한이 생기지 않습니다.
--
-- ★ 실패 사유를 나누지 않습니다 (리뷰 Minor 10).
--   폐기 · 중지 · 만료를 미상과 다르게 답하면, 그 차이가 "이 해시는 존재한다" 를 알려줍니다.
--   해시를 대량으로 넣어 보는 쪽에 그 신호를 주지 않습니다.
--   키 주인은 관리자 화면(analytics.v_api_key)에서 자기 키의 상태를 정확히 볼 수 있습니다.

create or replace function core.api_key_authenticate(p_hash text)
returns table (key_id text, integration_name text, scope text[], ok boolean, message text)
language plpgsql
volatile
security definer
set search_path = core, public
as $$
declare
  v_key_id text;
  v_name   text;
  v_scope  text[];
  -- 미상 · 폐기 · 중지 · 만료가 모두 같은 문구입니다.
  c_denied constant text := 'API 키를 확인할 수 없습니다. 키가 올바른지, 폐기되거나 만료되지 않았는지 관리자에게 확인해주세요.';
begin
  if p_hash is null or length(p_hash) <> 64 then
    return query select null::text, null::text, null::text[], false, c_denied;
    return;
  end if;

  v_key_id := core.api_key_id_for_hash(p_hash);

  if v_key_id is null then
    return query select null::text, null::text, null::text[], false, c_denied;
    return;
  end if;

  select k.integration_name, k.scope
    into v_name, v_scope
    from core.api_key k
   where k.key_id = v_key_id;

  update core.api_key k
     set last_used_at = now()
   where k.key_id = v_key_id;

  return query select v_key_id, v_name, coalesce(v_scope, '{}'::text[]), true, 'ok'::text;
end;
$$;

comment on function core.api_key_authenticate(text) is
  'renew.prd 9.3 — Bearer 토큰의 sha256 을 받아 살아 있는 키인지 판정합니다. 실패하면 ok=false 와 NULL 만 돌려줍니다';

-- ══ 5. 키 발급 · 폐기 (관리자) ═════════════════════════════════
--
-- 원문은 앱이 crypto.randomBytes 로 만들고, 여기에는 **해시와 접두어만** 넘어옵니다.
-- 이 함수는 원문을 볼 수 없습니다.

create or replace function core.api_key_create(
  p_integration_name text,
  p_scope            text[],
  p_expires_at       timestamptz,
  p_hash             text,
  p_prefix           text
)
returns table (key_id text, message text)
language plpgsql
volatile
security definer
set search_path = core, public
as $$
declare
  v_key_id  text;
  v_email   text;
  v_allowed text[] := array['demand:write', 'inventory:write', 'purchase_order:write',
                            'forecast:read', 'recommendation:read', 'alert:read'];
  v_bad     text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  if p_integration_name is null or btrim(p_integration_name) = '' then
    return query select null::text, '연동 이름을 입력해주세요.'::text;
    return;
  end if;

  if p_scope is null or array_length(p_scope, 1) is null then
    return query select null::text, '권한(scope)을 하나 이상 선택해주세요.'::text;
    return;
  end if;

  -- ★ error.md #20 — `s <> all(v_allowed)` 는 s 가 NULL 이면 NULL 이라 where 가 걸러 버립니다.
  --   그러면 NULL 원소가 든 scope 배열이 그대로 저장되고, 나중에 게이트가 NULL 로 열립니다.
  --   "NULL 이거나, 허용 목록에 없거나" 를 함께 봅니다.
  if exists (select 1 from unnest(p_scope) s where s is null or s <> all(v_allowed)) then
    select s into v_bad from unnest(p_scope) s where s is null or s <> all(v_allowed) limit 1;
    return query select null::text,
                        ('알 수 없는 권한입니다: ' || coalesce(v_bad, '(빈 값)'))::text;
    return;
  end if;

  if p_hash is null or length(p_hash) <> 64 then
    return query select null::text, '키 해시가 올바르지 않습니다.'::text;
    return;
  end if;

  if exists (select 1 from core.api_key k where k.key_hash = p_hash) then
    return query select null::text, '이미 등록된 키입니다.'::text;
    return;
  end if;

  v_key_id := 'key_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  select u.email into v_email from core.app_user u where u.user_id = auth.uid();

  insert into core.api_key (key_id, integration_name, key_hash, key_prefix, scope,
                            active, created_by, created_email, expires_at)
  values (v_key_id, btrim(p_integration_name), p_hash, coalesce(p_prefix, ''), p_scope,
          true, auth.uid(), v_email, p_expires_at);

  return query select v_key_id, '키를 발급했습니다.'::text;
end;
$$;

create or replace function core.api_key_revoke(p_key_id text)
returns table (ok boolean, message text)
language plpgsql
volatile
security definer
set search_path = core, public
as $$
declare
  v_found boolean;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  update core.api_key k
     set active = false, revoked_at = now()
   where k.key_id = p_key_id
     and k.revoked_at is null;

  get diagnostics v_found = row_count;

  if not v_found then
    return query select false, '이미 폐기되었거나 없는 키입니다.'::text;
    return;
  end if;

  return query select true, '키를 폐기했습니다. 이 키로는 더 이상 호출할 수 없습니다.'::text;
end;
$$;

-- ══ 6. 호출 기록 ═══════════════════════════════════════════════
--
-- p 예시
--   { "key_hash": "<sha256 hex>", "method": "POST", "path": "/api/v1/demand-history",
--     "status": 200, "duration_ms": 41, "received": 2, "accepted": 1, "rejected": 1,
--     "batch_id": "b_...", "ip": "1.2.3.4",
--     "idempotency_key": "...", "response": { ... } }
--
-- key_hash 는 **기록하지 않습니다.** key_id 로 바꿔 담기만 합니다.
-- 해시가 없거나 틀리면 key_id 는 NULL 로 남습니다 (401 도 기록해야 하므로 거부하지 않습니다).
--
-- 한계 — anon 이 부를 수 있으므로 인증 없는 호출도 행을 만듭니다. 이 테이블은
-- insert 전용이고 읽기는 관리자 뷰로만 열려 있습니다. 조회 · 수정 · 삭제는 되지 않습니다.

create or replace function core.api_log_write(p jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = core, public
as $$
declare
  v_key_id text;
  v_id     bigint;
  v_status int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return null;
  end if;

  v_key_id := core.api_key_id_for_hash(p ->> 'key_hash');

  -- ★ 인증되지 않은 호출은 행을 만들지 않습니다 (리뷰 Important 6).
  --   (날짜, 상태코드) 카운터만 올립니다. 호출자가 넣은 method · path · ip ·
  --   received/accepted/rejected 는 하나도 저장하지 않습니다 — 전부 위조 가능한 값입니다.
  --
  -- ★ status 도 호출자가 정하는 값입니다 (재리뷰 B).
  --   그대로 키에 넣으면, 인증 없이 이 함수를 PostgREST 로 직접 부르며 status 를
  --   1 · 2 · 3 … 으로 바꾸는 것만으로 하루 21억 행을 만들 수 있습니다.
  --   Next 핸들러의 IP 제한(120/분)은 앱을 거치지 않는 직접 RPC 호출에 닿지 않습니다.
  --
  --   그래서 **아는 상태코드만** 그대로 세고 나머지는 0 으로 몰아넣습니다.
  --   하루 행 수가 아래 목록 크기 + 1 로 묶입니다.
  if v_key_id is null then
    v_status := case
                  when (p ->> 'status') ~ '^[1-5][0-9][0-9]$'
                   and (p ->> 'status')::int in (400, 401, 403, 404, 405, 409, 413, 415,
                                                 422, 429, 500, 501, 502, 503)
                  then (p ->> 'status')::int
                  else 0            -- 그 밖은 전부 한 칸에 모읍니다
                end;

    insert into core.api_anon_stat (day, status, n)
    values (current_date, v_status, 1)
    on conflict (day, status) do update set n = core.api_anon_stat.n + 1;
    return null;
  end if;

  insert into core.api_log (key_id, method, path, status, duration_ms,
                            received, accepted, rejected, batch_id, ip,
                            idempotency_key, response)
  values (
    v_key_id,
    left(coalesce(p ->> 'method', ''), 10),
    left(coalesce(p ->> 'path', ''), 300),
    -- 숫자가 아니면 null 로 둡니다. 캐스팅이 터지면 기록 자체가 실패합니다.
    case when (p ->> 'status')      ~ '^-?[0-9]{1,9}$' then (p ->> 'status')::int      end,
    case when (p ->> 'duration_ms') ~ '^-?[0-9]{1,9}$' then (p ->> 'duration_ms')::int end,
    case when (p ->> 'received')    ~ '^-?[0-9]{1,9}$' then (p ->> 'received')::int    end,
    case when (p ->> 'accepted')    ~ '^-?[0-9]{1,9}$' then (p ->> 'accepted')::int    end,
    case when (p ->> 'rejected')    ~ '^-?[0-9]{1,9}$' then (p ->> 'rejected')::int    end,
    left(nullif(p ->> 'batch_id', ''), 100),
    left(nullif(p ->> 'ip', ''), 60),
    left(nullif(p ->> 'idempotency_key', ''), 200),
    p -> 'response'
  )
  returning core.api_log.id into v_id;

  return v_id;
end;
$$;

comment on function core.api_log_write(jsonb) is
  'renew.prd 9 — 호출 기록. 유효한 키 해시가 있을 때만 행을 만들고, 그 밖에는 core.api_anon_stat 카운터만 올립니다';

-- 같은 Idempotency-Key 로 다시 들어온 요청에 돌려줄 지난 응답 (renew.prd 9.1).
--
-- 키 해시로 인증한 뒤, **그 키가 만든 행만** 봅니다.
-- 다른 연동이 쓴 멱등 키는 보이지 않습니다.

create or replace function core.api_log_find_idempotent(p_key_hash text, p_idempotency_key text)
returns table (response jsonb, status int, at timestamptz)
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_key_id text;
begin
  v_key_id := core.api_key_id_for_hash(p_key_hash);

  if v_key_id is null or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return;   -- 0행
  end if;

  return query
    select l.response, l.status, l.at
      from core.api_log l
     where l.key_id          = v_key_id
       and l.idempotency_key = p_idempotency_key
       and l.response is not null
     order by l.at desc
     limit 1;
end;
$$;

-- ══ 7. 적재 — sql/09 의 분리 ★ ═════════════════════════════════
--
-- sql/09-import-commit.sql 의 core.import_commit 은 첫 줄에서 core.is_admin() 을 봅니다.
-- API 요청에는 세션이 없어 is_admin() 이 false 이므로 그대로는 부를 수 없습니다.
--
-- 그래서 본문을 core.import_commit_internal 로 옮기고,
--   · core.import_commit      관리자 검사 → internal        (화면 · 파일 업로드용, 기존과 동일)
--   · core.api_import_commit  키 해시 검사 → 배치 소유 확인 → internal   (API 전용)
-- 두 문(門)이 같은 본문을 씁니다. 적재 규칙이 두 벌이 되지 않습니다.
--
-- internal 은 **아무에게도** execute 를 주지 않습니다. 두 문을 거치지 않고는 부를 수 없습니다.

create or replace function core.import_commit_internal(p_batch_id text)
returns table (imported bigint, message text)
language plpgsql
security definer
set search_path = core, raw, public
as $$
declare
  b            core.upload_batch%rowtype;
  tbl          text;
  meta         jsonb;
  key_fields   text[];
  payload_keys text[];
  col_list     text;
  sel_list     text;
  cond         text;
  period_field text;
  period_from  text;
  period_to    text;
  n            bigint := 0;
begin
  -- ★ 권한 검사가 없습니다. 호출자(import_commit · api_import_commit)가 이미 했습니다.
  select * into b from core.upload_batch where batch_id = p_batch_id;
  if not found then
    return query select 0::bigint, '배치를 찾을 수 없습니다'::text;
    return;
  end if;

  if b.status <> 'PENDING' then
    return query select 0::bigint, ('이미 처리된 배치입니다 (' || b.status || ')')::text;
    return;
  end if;

  -- target_table 은 'raw.usage_history' 형태로 저장되어 있습니다.
  tbl := split_part(b.target_table, '.', 2);
  if to_regclass('raw.' || tbl) is null then
    return query select 0::bigint, ('대상 테이블이 없습니다: ' || b.target_table)::text;
    return;
  end if;

  -- 적재할 행이 있는지 먼저 봅니다.
  if not exists (
    select 1 from core.import_staging
     where batch_id = p_batch_id and is_valid
  ) then
    update core.upload_batch
       set status = 'FAILED', imported_at = now(),
           message = '적재할 수 있는 행이 없습니다'
     where batch_id = p_batch_id;
    return query select 0::bigint, '적재할 수 있는 행이 없습니다. 오류를 고쳐 다시 올려주세요'::text;
    return;
  end if;

  -- 모든 행에 붙일 적재 추적 값 (renew.prd 6.1)
  meta := jsonb_build_object(
    'batch_id',    p_batch_id,
    'source_type', b.source_type,
    'loaded_at',   to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );

  -- payload 키 ∩ 실제 컬럼만 씁니다. 없는 컬럼으로 넣으면 실패합니다.
  select array_agg(distinct k)
    into payload_keys
    from core.import_staging s,
         lateral jsonb_object_keys(s.payload || meta) k
   where s.batch_id = p_batch_id;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('(t.r).' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into col_list, sel_list
    from information_schema.columns c
   where c.table_schema = 'raw'
     and c.table_name   = tbl
     and c.column_name  = any(payload_keys);

  if col_list is null then
    return query select 0::bigint, '매핑된 컬럼이 대상 테이블에 하나도 없습니다'::text;
    return;
  end if;

  -- ── replace — 대상 기간을 먼저 지웁니다 ──────────────────────
  if b.mode = 'replace' then
    period_field := b.options ->> 'periodField';
    period_from  := b.options ->> 'periodFrom';
    period_to    := b.options ->> 'periodTo';

    if period_field is null or period_from is null or period_to is null then
      return query select 0::bigint, '기간 교체에는 기준 컬럼과 시작·종료일이 필요합니다'::text;
      return;
    end if;

    execute format('delete from raw.%I where %I between $1::date and $2::date',
                   tbl, period_field)
      using period_from, period_to;
  end if;

  -- ── upsert — 같은 키의 기존 행을 지웁니다 ────────────────────
  --
  -- raw 테이블에 유니크 제약이 없어 on conflict 를 쓸 수 없습니다.
  if b.mode = 'upsert' then
    select array_agg(value::text)
      into key_fields
      from jsonb_array_elements_text(coalesce(b.options -> 'keyFields', '[]'::jsonb)) as value;

    if key_fields is null or array_length(key_fields, 1) is null then
      return query select 0::bigint, '갱신 방식에는 키 컬럼이 필요합니다'::text;
      return;
    end if;

    select string_agg(format('s.payload->>%L = t.%I::text', k, k), ' and ')
      into cond
      from unnest(key_fields) k;

    execute format(
      'delete from raw.%I t
        where exists (select 1 from core.import_staging s
                       where s.batch_id = $1 and s.is_valid and %s)', tbl, cond)
      using p_batch_id;
  end if;

  -- ── 적재 ─────────────────────────────────────────────────────
  execute format(
    'insert into raw.%I (%s)
     select %s from (
       select jsonb_populate_record(null::raw.%I, s.payload || $2) as r
         from core.import_staging s
        where s.batch_id = $1 and s.is_valid
        order by s.row_number
     ) t', tbl, col_list, sel_list, tbl)
    using p_batch_id, meta;

  get diagnostics n = row_count;

  update core.upload_batch
     set status = 'IMPORTED', imported_rows = n, imported_at = now(),
         message = n || '행을 적재했습니다'
   where batch_id = p_batch_id;

  -- 임시 보관만 비웁니다. 검증 오류는 남겨 둡니다 (renew.prd 8.3).
  delete from core.import_staging where batch_id = p_batch_id;

  return query select n, (n || '행을 적재했습니다')::text;
exception
  when others then
    update core.upload_batch
       set status = 'FAILED', imported_at = now(), message = SQLERRM
     where batch_id = p_batch_id;
    return query select 0::bigint, ('적재에 실패했습니다: ' || SQLERRM)::text;
end;
$$;

comment on function core.import_commit_internal(text) is
  '★ 권한 검사 없음. core.import_commit(관리자) 과 core.api_import_commit(API 키)만 부릅니다. 아무에게도 execute 를 주지 않습니다';

revoke all on function core.import_commit_internal(text) from public, anon, authenticated;

-- 기존 문 — 화면과 파일 업로드가 부릅니다. 동작은 sql/09 와 같습니다.
create or replace function core.import_commit(p_batch_id text)
returns table (imported bigint, message text)
language plpgsql
security definer
set search_path = core, raw, public
as $$
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  return query select r.imported, r.message from core.import_commit_internal(p_batch_id) r;
end;
$$;

revoke all on function core.import_commit(text) from public, anon;
grant execute on function core.import_commit(text) to authenticated;

-- API 전용 문 — 키 해시로 인증하고, **그 키가 만든 배치만** 적재합니다.
--
-- 두 번째 인자가 key_id 가 아니라 key_hash 인 이유:
--   key_id 는 관리자 화면과 호출 로그에 그대로 보이는 값이라 비밀이 아닙니다.
--   key_id 만 맞추면 통과하게 두면, 인증 없는 호출자가 batch_id 를 맞히는 것만으로
--   남의 배치를 적재할 수 있습니다.
create or replace function core.api_import_commit(p_batch_id text, p_key_hash text)
returns table (imported bigint, message text)
language plpgsql
volatile
security definer
set search_path = core, raw, public
as $$
declare
  v_key_id   text;
  v_owner    text;
  v_imported bigint;
  v_message  text;
begin
  v_key_id := core.api_key_id_for_hash(p_key_hash);

  -- NULL 이면 거부입니다. 여기로 NULL 이 통과하는 길이 없습니다 (error.md #20).
  if v_key_id is null then
    return query select 0::bigint, 'API 키를 확인할 수 없습니다.'::text;
    return;
  end if;

  select b.uploader_email into v_owner
    from core.upload_batch b
   where b.batch_id = p_batch_id;

  if v_owner is null or v_owner <> ('api:' || v_key_id) then
    return query select 0::bigint, '이 키가 만든 배치가 아닙니다.'::text;
    return;
  end if;

  select r.imported, r.message into v_imported, v_message
    from core.import_commit_internal(p_batch_id) r;

  -- ★ Postgres 원문(SQLERRM)을 외부 호출자에게 돌려주지 않습니다 (리뷰 Minor 9).
  --   import_commit_internal 은 예외를 잡아 '적재에 실패했습니다: ' || SQLERRM 을 돌려줍니다.
  --   그 전문은 core.upload_batch.message 에 남아 관리자가 볼 수 있으므로 잃는 것이 없습니다.
  --   그 밖의 사유('적재할 수 있는 행이 없습니다' · '이미 처리된 배치입니다' 등)는
  --   호출자가 스스로 고칠 수 있는 내용이라 그대로 전합니다 (리뷰 Important 5).
  if v_message like '적재에 실패했습니다:%' then
    v_message := '적재에 실패했습니다. 관리자에게 배치 번호를 알려주세요: ' || p_batch_id;
  end if;

  return query select coalesce(v_imported, 0::bigint), v_message;
end;
$$;

-- ══ 7-2. 검증에 필요한 정보 ★ ══════════════════════════════════
--
-- ★ 왜 필요한가 (리뷰 Critical 2)
--
--   lib/import/repository.ts 의 loadValidationContext() 는 네 곳을 **직접 select** 합니다.
--     core.v_item_master · analytics.v_leadtime_gap · analytics.v_raw_schema · core.column_mapping
--   Route Handler 에는 세션이 없어 그 조회가 anon 으로 나갑니다. 지금은
--   sql/01-grants.sql 의 무차별 grant 덕분에만 되고, sql/28-anon-lockdown.sql 이
--   그것을 거둡니다.
--
--   더 나쁜 것은 **조용히 깨진다**는 점입니다. loadValidationContext 는 오류를
--   `.data ?? []` 로 삼켜 빈 집합을 돌려주고, lib/import/validate.ts 의
--   `context.knownItemIds.size > 0` 가드가 그 빈 집합을 보고 UNKNOWN_ITEM ·
--   UNKNOWN_SUPPLIER · 대상 컬럼 검사를 **통째로 건너뜁니다.**
--   그러면 파일 업로드는 거절하는 행을 API 는 받아들입니다 — 이 STEP 이 막으려던
--   "규칙이 두 벌" 이 권한 설정 하나로 생깁니다.
--
--   그래서 같은 네 곳을 키 해시로 인증한 뒤 대신 읽어주는 함수를 둡니다.
--   **읽는 곳이 같으므로 규칙은 한 벌 그대로입니다.** 검증 자체는 여전히
--   lib/import/validate.ts 만 합니다. 이 함수는 재료만 건넵니다.
--   `lib/api/context-parity.test.ts` 가 두 파일이 같은 뷰를 보는지 대조합니다.
--
-- ★ 왜 배열로 돌려주는가
--   PostgREST 는 한 번에 1,000행까지만 돌려줍니다(공통규칙 11). 품목이 1,000개를
--   넘으면 `.select('item_id')` 는 조용히 잘리고, 잘린 뒤의 품목이 전부
--   UNKNOWN_ITEM 이 됩니다. 집계해서 배열 하나로 돌려주면 그 상한에 걸리지 않습니다.

create or replace function core.api_validation_context(p_key_hash text, p_data_type text)
returns table (
  item_ids       text[],
  supplier_ids   text[],
  target_columns text[],
  saved_mapping  jsonb
)
language plpgsql
stable
security definer
set search_path = core, analytics, public
as $$
declare
  v_key_id text;
  v_target text;
  v_table  text;
begin
  v_key_id := core.api_key_id_for_hash(p_key_hash);

  -- NULL 이면 거부입니다. 0행을 돌려주고, 호출부는 0행을 503 으로 봅니다 —
  -- **빈 컨텍스트로 검증을 진행하지 않습니다.**
  if v_key_id is null then
    return;
  end if;

  select t.target_table into v_target
    from core.api_target_for_data_type(p_data_type) t;

  if v_target is null then
    return;
  end if;

  v_table := split_part(v_target, '.', 2);

  -- ★ ::text 캐스팅이 필요합니다.
  --   analytics.v_raw_schema 는 information_schema.columns 를 그대로 내보내므로
  --   column_name 의 타입이 text 가 아니라 information_schema.sql_identifier 입니다.
  --   캐스팅하지 않으면 실행 시점에
  --   "structure of query does not match function result type" 로 터집니다.
  --   (파일을 실행만 해서는 안 잡힙니다 — 함수를 실제로 불러야 나옵니다.)
  return query
    select
      (select coalesce(array_agg(m.item_id::text), '{}') from core.v_item_master m),
      (select coalesce(array_agg(g.supplier_id::text), '{}') from analytics.v_leadtime_gap g),
      (select coalesce(array_agg(c.column_name::text), '{}')
         from analytics.v_raw_schema c
        where c.table_name::text = v_table),
      -- renew.prd 8.2 — 관리자가 저장해 둔 매핑 규칙. 파일 업로드가 자동 매핑 위에
      -- 덮어쓰는 것과 같은 값입니다 (리뷰 Minor 8).
      (select coalesce(jsonb_object_agg(cm.source_column, cm.target_column), '{}'::jsonb)
         from core.column_mapping cm
        where cm.data_type = p_data_type);
end;
$$;

comment on function core.api_validation_context(text, text) is
  '★ renew.prd 9.1 · 8.3 — API 검증에 쓸 마스터 목록 · 대상 컬럼 · 저장된 매핑. lib/import/repository.ts 의 loadValidationContext 와 같은 곳을 읽습니다. 키 해시로 인증하지 못하면 0행입니다';

-- ══ 8. API 적재 준비 ═══════════════════════════════════════════
--
-- core.upload_batch · import_staging · validation_error 는 RLS 로 관리자만 씁니다.
-- API 요청에는 세션이 없으므로 이 함수가 대신 넣습니다.
--
-- ★ 호출자에게서 받는 값은 다음뿐입니다.
--     key_hash · data_type · mode · strict 결과(rows[].is_valid) · mapping · counts ·
--     rows[] · errors[] · period_from · period_to
--   target_table · period_field · key_fields 는 **data_type 에서 도출**합니다 (§2-2).
--   batch_id 도 여기서 만듭니다. 호출자가 정하게 두면 남의 배치 번호와 부딪히게 만들 수 있습니다.
--
-- p 예시
--   { "key_hash": "<sha256 hex>", "data_type": "DEMAND", "mode": "upsert",
--     "mapping": {...},
--     "period_from": "2025-03-01", "period_to": "2025-03-31",   -- mode='replace' 일 때만
--     "counts": { "total": 2, "success": 1, "warning": 0, "error": 1 },
--     "rows":   [ { "row_number": 1, "payload": {...}, "raw_row": {...}, "is_valid": true } ],
--     "errors": [ { "row_number": 1, "column_name": "item_id",
--                   "severity": "ERROR", "code": "UNKNOWN_ITEM", "message": "...",
--                   "raw_row": {...} } ] }

create or replace function core.api_stage_batch(p jsonb)
returns table (ok boolean, batch_id text, message text)
language plpgsql
volatile
security definer
set search_path = core, public
as $$
declare
  v_key_id    text;
  v_scope     text[];
  v_need      text;
  v_batch_id  text;
  v_data_type text;
  v_target    text;
  v_period    text;
  v_keys      text[];
  v_mode      text;
  v_from      text;
  v_to        text;
  v_missing   text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return query select false, null::text, '요청 본문이 올바르지 않습니다.'::text;
    return;
  end if;

  -- ① 인증 — NULL 이면 거부. 통과하는 길이 없습니다 (error.md #20)
  v_key_id := core.api_key_id_for_hash(p ->> 'key_hash');
  if v_key_id is null then
    return query select false, null::text, 'API 키를 확인할 수 없습니다.'::text;
    return;
  end if;

  -- ② 권한 — 앱이 이미 봤지만 여기서 한 번 더 봅니다
  v_data_type := p ->> 'data_type';
  v_need      := core.api_scope_for_data_type(v_data_type);

  if v_need is null then
    return query select false, null::text,
                        ('알 수 없는 데이터 종류입니다: ' || coalesce(v_data_type, '(없음)'))::text;
    return;
  end if;

  select k.scope into v_scope from core.api_key k where k.key_id = v_key_id;

  -- ★ error.md #20 — scope 배열에 NULL 원소가 하나라도 있으면
  --   `v_need <> all(v_scope)` 가 NULL 이 되어 게이트가 통과합니다.
  --   "가지고 있는가" 를 물어 coalesce 로 NULL 을 false 로 접습니다.
  if not coalesce(v_need = any(v_scope), false) then
    return query select false, null::text, ('이 키에는 ' || v_need || ' 권한이 없습니다.')::text;
    return;
  end if;

  -- ③ 적재 대상 — ★ 호출자가 준 target_table 을 쓰지 않습니다 (리뷰 Critical 1)
  select t.target_table, t.period_field, t.key_fields
    into v_target, v_period, v_keys
    from core.api_target_for_data_type(v_data_type) t;

  if v_target is null or to_regclass(v_target) is null then
    return query select false, null::text,
                        ('대상 테이블이 없습니다: ' || coalesce(v_target, '(없음)'))::text;
    return;
  end if;

  -- ④ 적재 방식
  v_mode := coalesce(p ->> 'mode', 'append');
  if v_mode not in ('append', 'replace', 'upsert') then
    return query select false, null::text, ('알 수 없는 적재 방식입니다: ' || v_mode)::text;
    return;
  end if;

  -- replace 는 기간을 지우고 다시 넣습니다. 지운 원본은 되돌릴 수 없으므로
  -- (core.rollback_batch 가 replace 배치를 거절합니다) 기간을 반드시 받습니다.
  if v_mode = 'replace' then
    if v_period is null then
      return query select false, null::text,
                        (v_data_type || ' 에는 기간 기준 컬럼이 없어 replace 를 쓸 수 없습니다.')::text;
      return;
    end if;

    v_from := p ->> 'period_from';
    v_to   := p ->> 'period_to';

    if v_from is null or v_to is null then
      return query select false, null::text,
                        'replace 에는 period_from 과 period_to 가 필요합니다.'::text;
      return;
    end if;

    -- 날짜가 아니면 여기서 막습니다. import_commit_internal 안에서 캐스팅 오류로 터지면
    -- 배치가 FAILED 로 남고 사유가 Postgres 원문이 됩니다.
    begin
      perform v_from::date, v_to::date;
    exception when others then
      return query select false, null::text,
                        'period_from · period_to 는 YYYY-MM-DD 형식이어야 합니다.'::text;
      return;
    end;

    if v_from::date > v_to::date then
      return query select false, null::text, 'period_from 이 period_to 보다 늦습니다.'::text;
      return;
    end if;
  end if;

  if jsonb_typeof(coalesce(p -> 'rows', '[]'::jsonb)) <> 'array' then
    return query select false, null::text, 'rows 는 배열이어야 합니다.'::text;
    return;
  end if;

  -- ④-2 키 · 기간 컬럼이 대상 테이블에 실제로 있는가
  --
  -- ★ raw 테이블의 컬럼명은 프로젝트마다 다릅니다 (sql/14-reload-real-data.sql §1 의 경고).
  --   lib/import/schema.ts 의 TABLE_SPECS 가 논리 이름(item_id 등)을 쓰는데, 실제 테이블이
  --   다른 이름(품목코드 등)이면 upsert 의 `delete … where t.item_id = …` 가
  --   "column t.item_id does not exist" 로 터집니다. 그때는 배치가 이미 만들어진 뒤라
  --   FAILED 로 남고, 연동은 500 만 받습니다.
  --
  --   그래서 **적재를 시작하기 전에** 확인하고, 무엇이 없는지 그대로 알려줍니다.
  --   append 는 payload 키 ∩ 실제 컬럼으로만 넣으므로 이 검사가 필요 없습니다.
  if v_mode in ('upsert', 'replace') then
    select string_agg(k, ', ' order by k) into v_missing
      from unnest(v_keys) k
     where not exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'raw'
          and c.table_name   = split_part(v_target, '.', 2)
          and c.column_name::text = k);

    if v_missing is not null then
      return query select false, null::text,
        (v_mode || ' 방식은 키 컬럼이 대상 테이블에 있어야 하는데 '
         || v_target || ' 에 없습니다: ' || v_missing
         || '. 관리자에게 컬럼 매핑 확인을 요청해주세요.')::text;
      return;
    end if;

    if v_mode = 'replace' and not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'raw'
         and c.table_name   = split_part(v_target, '.', 2)
         and c.column_name::text = v_period)
    then
      return query select false, null::text,
        ('기간 기준 컬럼 ' || v_period || ' 이 ' || v_target || ' 에 없습니다.')::text;
      return;
    end if;
  end if;

  -- ⑤ 배치 생성
  v_batch_id := 'b_api_' || to_char(now(), 'YYYYMMDD') || '_'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  insert into core.upload_batch (
    batch_id, filename, data_type, target_table, source_type, mode, status,
    total_rows, success_rows, warning_rows, error_rows,
    mapping, options, uploader, uploader_email
  ) values (
    v_batch_id,
    null,                                        -- API 요청에는 파일이 없습니다
    v_data_type,
    v_target,                                    -- ★ data_type 이 정합니다
    'API',                                       -- ★ 호출자가 정하지 않습니다
    v_mode,
    'PENDING',
    coalesce((p #>> '{counts,total}')::int,   0),
    coalesce((p #>> '{counts,success}')::int, 0),
    coalesce((p #>> '{counts,warning}')::int, 0),
    coalesce((p #>> '{counts,error}')::int,   0),
    p -> 'mapping',
    -- ★ import_commit_internal 이 읽는 값입니다. 전부 여기서 만든 것만 담습니다.
    jsonb_strip_nulls(jsonb_build_object(
      'keyFields',   to_jsonb(v_keys),
      'periodField', v_period,
      'periodFrom',  v_from,
      'periodTo',    v_to
    )),
    null,                                        -- auth.users 행이 없습니다
    'api:' || v_key_id                           -- ★ api_import_commit 이 이 값을 봅니다
  );

  insert into core.import_staging (batch_id, row_number, payload, raw_row, is_valid)
  select v_batch_id,
         coalesce((t.r ->> 'row_number')::int, t.ord::int),
         coalesce(t.r -> 'payload', '{}'::jsonb),
         t.r -> 'raw_row',
         -- 모르는 값은 "적재하지 않음" 으로 둡니다
         coalesce((t.r ->> 'is_valid')::boolean, false)
    from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb))
         with ordinality as t(r, ord);

  if jsonb_typeof(coalesce(p -> 'errors', '[]'::jsonb)) = 'array' then
    insert into core.validation_error (batch_id, row_number, column_name,
                                       severity, code, message, raw_row)
    select v_batch_id,
           coalesce((t.e ->> 'row_number')::int, 0),
           t.e ->> 'column_name',
           case when t.e ->> 'severity' = 'WARNING' then 'WARNING' else 'ERROR' end,
           coalesce(t.e ->> 'code', 'UNKNOWN'),
           coalesce(t.e ->> 'message', ''),
           t.e -> 'raw_row'
      from jsonb_array_elements(coalesce(p -> 'errors', '[]'::jsonb))
           with ordinality as t(e, ord);
  end if;

  return query select true, v_batch_id, '적재 준비를 마쳤습니다.'::text;
exception
  when others then
    -- ★ SQLERRM 을 외부 호출자에게 돌려주지 않습니다 (리뷰 Minor 9).
    --   Postgres 원문은 서버 로그에만 남기고, 호출자에게는 사유 없는 실패만 알립니다.
    raise warning '[api_stage_batch] % (key=%, data_type=%)', SQLERRM, v_key_id, v_data_type;
    return query select false, null::text, '적재 준비에 실패했습니다.'::text;
end;
$$;

-- ══ 9. analytics 뷰 ════════════════════════════════════════════
--
-- 셋 다 `where core.is_admin()` 으로 막습니다.
-- 뷰는 postgres 소유라 RLS 를 우회하므로, 조건을 뷰 안에 둡니다 (sql/22 의 v_agent_usage 와 같은 방식).
--
-- ★ v_api_key 에 key_hash 가 없습니다. 화면이 해시를 볼 이유가 없습니다.

create or replace view analytics.v_api_key as
select k.key_id,
       k.integration_name,
       k.key_prefix,
       k.scope,
       k.active,
       k.created_email,
       k.created_at,
       k.expires_at,
       k.last_used_at,
       k.revoked_at,
       case
         when k.revoked_at is not null                              then 'REVOKED'
         when k.active is not true                                  then 'INACTIVE'
         when k.expires_at is not null and k.expires_at <= now()    then 'EXPIRED'
         else 'ACTIVE'
       end                                                          as status,
       (select count(*) from core.api_log l where l.key_id = k.key_id) as call_count
  from core.api_key k
 where core.is_admin();

comment on view analytics.v_api_key is
  'renew.prd 9.3 — API 키 목록. key_hash 는 담지 않습니다. 관리자에게만 행이 나옵니다';

create or replace view analytics.v_api_log as
select l.id,
       l.key_id,
       k.integration_name,
       l.method,
       l.path,
       l.status,
       l.duration_ms,
       l.received,
       l.accepted,
       l.rejected,
       l.batch_id,
       l.ip,
       l.idempotency_key,
       l.at
  from core.api_log l
  left join core.api_key k on k.key_id = l.key_id
 where core.is_admin()
 order by l.at desc
 limit 1000;

comment on view analytics.v_api_log is 'renew.prd 9 — 최근 API 호출 1,000건. 관리자에게만 행이 나옵니다';

-- KPI 한 줄. 집계라 호출이 하나도 없어도 항상 1행입니다.
create or replace view analytics.v_api_kpi as
select
  count(*) filter (where l.at >= date_trunc('day', now()))                            as calls_today,
  count(*) filter (where l.at >= date_trunc('day', now())
                     and l.status between 400 and 499)                                as client_error_today,
  count(*) filter (where l.at >= date_trunc('day', now())
                     and l.status >= 500)                                             as server_error_today,
  coalesce(sum(l.accepted) filter (where l.at >= date_trunc('day', now())), 0)::bigint as accepted_today,
  coalesce(sum(l.rejected) filter (where l.at >= date_trunc('day', now())), 0)::bigint as rejected_today,
  count(*)                                                                            as calls_total,
  (select count(*) from core.api_key k
    where core.is_admin()
      and k.active is true
      and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now()))                             as active_keys,
  -- ★ 새 컬럼은 반드시 맨 뒤에 붙입니다. create or replace view 는 컬럼 순서를 바꾸거나
  --   빼는 것을 거부합니다 (공통규칙 15). 인증되지 않은 호출은 core.api_log 에 행이 없으므로
  --   카운터 테이블에서 읽습니다 (§1).
  coalesce((select sum(a.n) from core.api_anon_stat a
             where core.is_admin() and a.day = current_date), 0)::bigint              as anon_today
from core.api_log l
where core.is_admin();

comment on view analytics.v_api_kpi is 'renew.prd 9 — 오늘 호출 · 4xx · 5xx · 적재 행. 관리자에게만 값이 나옵니다';

-- ══ 10. 권한 ═══════════════════════════════════════════════════
--
-- 테이블 — 관리자만 읽습니다. 쓰기는 위의 security definer 함수만 합니다.
-- (함수는 postgres 소유라 RLS 를 우회합니다. 테이블에 write 정책을 두지 않습니다.)

grant select on core.api_key to authenticated;
revoke all  on core.api_key from anon;
alter table core.api_key enable row level security;
drop policy if exists api_key_read_admin on core.api_key;
create policy api_key_read_admin on core.api_key
  for select to authenticated using (core.is_admin());

grant select on core.api_log to authenticated;
revoke all  on core.api_log from anon;
alter table core.api_log enable row level security;
drop policy if exists api_log_read_admin on core.api_log;
create policy api_log_read_admin on core.api_log
  for select to authenticated using (core.is_admin());

grant select on core.api_anon_stat to authenticated;
revoke all  on core.api_anon_stat from anon;
alter table core.api_anon_stat enable row level security;
drop policy if exists api_anon_stat_read_admin on core.api_anon_stat;
create policy api_anon_stat_read_admin on core.api_anon_stat
  for select to authenticated using (core.is_admin());

-- 시퀀스는 아무에게도 주지 않습니다. insert 는 전부 definer 함수 안에서 일어납니다.

grant select on analytics.v_api_key to authenticated;
grant select on analytics.v_api_log to authenticated;
grant select on analytics.v_api_kpi to authenticated;
revoke all on analytics.v_api_key from anon;
revoke all on analytics.v_api_log from anon;
revoke all on analytics.v_api_kpi from anon;

-- 관리자 전용 함수
revoke all on function core.api_key_create(text, text[], timestamptz, text, text) from public, anon;
grant execute on function core.api_key_create(text, text[], timestamptz, text, text) to authenticated;

revoke all on function core.api_key_revoke(text) from public, anon;
grant execute on function core.api_key_revoke(text) to authenticated;

-- ★ anon 실행 허용 — Route Handler 에는 세션이 없습니다.
--   다섯 함수 모두 인자로 받은 key_hash 를 대조하며, 대조에 실패하면
--   아무 것도 돌려주지 않고 아무 것도 쓰지 않습니다.
revoke all on function core.api_key_authenticate(text) from public;
grant execute on function core.api_key_authenticate(text) to anon, authenticated;

revoke all on function core.api_log_write(jsonb) from public;
grant execute on function core.api_log_write(jsonb) to anon, authenticated;

revoke all on function core.api_log_find_idempotent(text, text) from public;
grant execute on function core.api_log_find_idempotent(text, text) to anon, authenticated;

revoke all on function core.api_stage_batch(jsonb) from public;
grant execute on function core.api_stage_batch(jsonb) to anon, authenticated;

revoke all on function core.api_import_commit(text, text) from public;
grant execute on function core.api_import_commit(text, text) to anon, authenticated;

revoke all on function core.api_scope_for_data_type(text) from public;
grant execute on function core.api_scope_for_data_type(text) to anon, authenticated;

-- 적재 대상 표는 **내부 전용**입니다. api_stage_batch · api_validation_context 가
-- security definer(소유자 postgres)로 부르므로 호출자에게 실행 권한이 필요 없습니다.
-- 표면을 넓히지 않습니다.
revoke all on function core.api_target_for_data_type(text) from public, anon, authenticated;

-- 검증 재료. anon 실행 허용 — 인자로 받은 해시를 검사하고, 실패하면 0행입니다.
revoke all on function core.api_validation_context(text, text) from public;
grant execute on function core.api_validation_context(text, text) to anon, authenticated;

-- ══ 10-2. service_role — Outbound(GET)가 읽을 것 ★ ═════════════
--
-- ★ 왜 필요한가
--
--   /api/v1 의 GET 라우트에는 로그인 세션이 없습니다. sql/28-anon-lockdown.sql 이
--   anon 에게서 core · analytics 를 전부 거뒀으므로, 앱은 **서버 전용 secret 키**로
--   조회합니다 (lib/supabase/service.ts). Supabase 에서 그 키는 `service_role` 로 접속합니다.
--
--   ★ service_role 의 BYPASSRLS 는 **정책만** 우회합니다. 테이블 GRANT 는 우회하지 않습니다.
--     sql/01-grants.sql 은 anon 과 authenticated 에게만 주었으므로 service_role 은
--     analytics 스키마에 들어가지도 못합니다("permission denied for schema analytics").
--     이 절이 없으면 GET 7개가 전부 502 입니다.
--
-- ★ 넓게 열지 않습니다.
--   `grant all on all tables` 로 열면 이 롤이 앞으로 생길 모든 것을 읽게 됩니다.
--   lib/api/outbound.ts 와 lib/api/atp-bridge.ts 가 실제로 읽는 **뷰 9개와 함수 1개**만 줍니다.
--   목록이 늘면 여기에 한 줄을 더해야 하며, 그것이 의도된 마찰입니다.
--
-- ★ 없는 객체에 grant 하면 42883/42P01 로 파일 전체가 롤백됩니다 (error.md #22).
--   앞 번호 파일을 아직 적용하지 않았을 수 있으므로 존재를 확인하고 줍니다.

grant usage on schema analytics to service_role;
grant usage on schema core      to service_role;

do $$
declare
  -- lib/api/outbound.ts 가 읽는 뷰 (조회 함수 → 뷰)
  v_views text[] := array[
    'analytics.v_forecast_run',            -- getForecastRuns        (forecast)
    'analytics.v_forecast_result',         -- getForecastDetail      (forecast)
    'analytics.v_inventory_projection',    -- getInventoryProjection (inventory-projection)
    'analytics.v_stockout_risk',           -- getStockoutRisk        (stockout-risk)
    'analytics.v_purchase_recommendation', -- getPurchaseRecommendation (order-recommendation)
    'analytics.v_safety_stock',            -- getSafetyStock         (order-recommendation)
    'analytics.v_leadtime_policy',         -- getLeadtimePolicy      (leadtime)
    'analytics.v_alert',                   -- getAlerts              (alerts)
    'analytics.v_atp'                      -- lib/api/atp-bridge.ts  (atp)  · sql/23
  ];
  v_name text;
begin
  foreach v_name in array v_views loop
    if to_regclass(v_name) is null then
      raise notice 'sql/26: % 가 없어 건너뜁니다 (해당 sql 파일 미적용)', v_name;
    else
      -- select 만 줍니다. Outbound 는 읽기 전용입니다.
      execute format('grant select on %s to service_role', v_name);
    end if;
  end loop;

  -- ATP 의 수주 가능 판정 (sql/23-atp-sales.sql). 읽기 전용 함수입니다 —
  -- 여러 번 물어도 재고가 잠기지 않습니다 (renew.prd 27.5).
  if to_regprocedure('core.check_order_feasibility(text, numeric, date)') is null then
    raise notice 'sql/26: core.check_order_feasibility 가 없어 건너뜁니다 (sql/23 미적용)';
  else
    execute 'grant execute on function core.check_order_feasibility(text, numeric, date) to service_role';
  end if;
end
$$;

-- ★ service_role 에 쓰기를 주지 않습니다.
--   Inbound 의 쓰기는 anon 이 부르는 security definer 함수(api_stage_batch ·
--   api_import_commit)가 소유자 권한으로 합니다. 조회용 롤에 쓰기를 겹쳐 줄 이유가 없습니다.

-- ══ 11. 확인 ═══════════════════════════════════════════════════
--
-- 읽기 전용입니다 (error.md #22). 키 발급 · 적재는 화면과 API 에서 합니다.

-- 테이블 두 개가 생겼는가
select table_schema, table_name
  from information_schema.tables
 where table_schema = 'core' and table_name in ('api_key', 'api_log', 'api_anon_stat')
 order by table_name;

-- 함수가 전부 security definer 인가
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname in ('api_key_id_for_hash', 'api_key_authenticate', 'api_key_create',
                     'api_target_for_data_type', 'api_validation_context',
                     'api_key_revoke', 'api_log_write', 'api_log_find_idempotent',
                     'api_stage_batch', 'api_import_commit',
                     'import_commit', 'import_commit_internal')
 order by p.proname;

-- ★ anon 이 실행할 수 있는 이 파일의 함수는 **일곱 개**입니다.
--     api_key_authenticate · api_log_write · api_log_find_idempotent ·
--     api_stage_batch · api_import_commit · api_scope_for_data_type · api_validation_context
--   일곱 모두 인자로 받은 키 해시를 스스로 검사하고, 실패하면 아무 것도 돌려주지 않습니다.
--
--   ★ 여기에 import_commit_internal · api_key_id_for_hash · api_target_for_data_type 이
--     보이면 안 됩니다. 셋은 security definer 호출 전용이라 실행 권한이 없어야 합니다.
--
--   아래 목록에는 다른 파일이 anon 에게 준 함수도 함께 나옵니다
--   (sql/20 의 scan_alerts · sql/23 의 release_expired_allocations 등).
--   sql/28-anon-lockdown.sql 을 적용한 뒤라면 그 파일 §5 의 허용 목록이 최종 기준입니다.
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and has_function_privilege('anon', p.oid, 'execute')
 order by p.proname;

-- 정책 두 개가 붙었는가
select schemaname, tablename, policyname, cmd
  from pg_policies
 where schemaname = 'core' and tablename in ('api_key', 'api_log', 'api_anon_stat')
 order by tablename, policyname;

-- 키 목록 (관리자 세션에서만 행이 나옵니다). key_hash 컬럼이 없어야 합니다
select column_name
  from information_schema.columns
 where table_schema = 'analytics' and table_name = 'v_api_key'
 order by ordinal_position;

select * from analytics.v_api_kpi;

-- ★ Outbound(GET)가 쓰는 service_role 권한. 9개 뷰가 전부 t 여야 합니다.
--   f 가 하나라도 있으면 그 경로가 502 를 돌려줍니다.
select v.name, has_table_privilege('service_role', v.name, 'select') as service_role_select
  from (values ('analytics.v_forecast_run'), ('analytics.v_forecast_result'),
               ('analytics.v_inventory_projection'), ('analytics.v_stockout_risk'),
               ('analytics.v_purchase_recommendation'), ('analytics.v_safety_stock'),
               ('analytics.v_leadtime_policy'), ('analytics.v_alert'),
               ('analytics.v_atp')) v(name)
 where to_regclass(v.name) is not null
 order by 1;

select has_schema_privilege('service_role', 'analytics', 'usage') as analytics_usage,
       has_schema_privilege('service_role', 'core', 'usage')      as core_usage;
