-- ──────────────────────────────────────────────────────────────
-- STEP 4 · 데이터 적재 파이프라인
--
-- renew.prd 8장 — File Import · Validation · Import History · Rollback
--
-- 여기서 만드는 것
--   core  upload_batch       업로드 단위
--   core  import_staging     적재 전 임시 보관 (미리보기 → 확인 → 적재)
--   core  validation_error   행 단위 오류
--   core  column_mapping     매핑 규칙 재사용
--   raw   쓰기 권한과 RLS (관리자만)
--   analytics  v_import_history · v_validation_error · v_raw_schema
--   core  rollback_batch()   배치 단위 되돌리기
--
-- sql/06-core-extend.sql 까지 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 업로드 배치 ═════════════════════════════════════════════

create table if not exists core.upload_batch (
  batch_id      text primary key,
  filename      text,
  data_type     text not null,   -- DEMAND · INVENTORY · PURCHASE_ORDER · …
  target_table  text not null,   -- raw.usage_history 등
  source_type   text not null,   -- MANUAL_CSV · MANUAL_EXCEL · MANUAL_JSON · API · ERP · BATCH
  mode          text not null default 'append' check (mode in ('append', 'replace', 'upsert')),
  status        text not null default 'PENDING'
                  check (status in ('PENDING', 'IMPORTED', 'CANCELLED', 'ROLLED_BACK', 'FAILED')),
  total_rows    int not null default 0,
  success_rows  int not null default 0,
  warning_rows  int not null default 0,
  error_rows    int not null default 0,
  imported_rows int not null default 0,
  mapping       jsonb,            -- 이번 업로드에 쓴 컬럼 매핑
  options       jsonb,            -- replace 대상 기간 등
  message       text,
  uploader      uuid references auth.users(id) on delete set null,
  uploader_email text,
  uploaded_at   timestamptz not null default now(),
  imported_at   timestamptz,
  rolled_back_at timestamptz
);

comment on table core.upload_batch is 'renew.prd 8.5 — Import History';

create index if not exists upload_batch_at_idx on core.upload_batch(uploaded_at desc);

-- ══ 2. 적재 전 임시 보관 ═══════════════════════════════════════
--
-- 미리보기와 실제 적재 사이에 파일을 다시 올리게 하지 않습니다.
-- 파싱 결과를 여기 두고, 사용자가 확인하면 target_table 로 옮깁니다.

create table if not exists core.import_staging (
  batch_id   text not null references core.upload_batch(batch_id) on delete cascade,
  row_number int  not null,
  payload    jsonb not null,   -- 매핑 적용 후의 행
  raw_row    jsonb,            -- 원본 행 (오류 CSV 내려받기용)
  is_valid   boolean not null default true,
  primary key (batch_id, row_number)
);

comment on table core.import_staging is '적재 전 임시 보관. 적재·취소 시 비웁니다';

-- ══ 3. 검증 오류 ═══════════════════════════════════════════════
--
-- renew.prd 8.3 — 임의 보정하지 않습니다. 행 번호와 사유를 그대로 보여줍니다.

create table if not exists core.validation_error (
  id          bigserial primary key,
  batch_id    text not null references core.upload_batch(batch_id) on delete cascade,
  row_number  int  not null,
  column_name text,
  severity    text not null check (severity in ('ERROR', 'WARNING')),
  code        text not null,   -- MISSING_COLUMN · INVALID_DATE · UNKNOWN_ITEM · …
  message     text not null,
  raw_row     jsonb
);

create index if not exists validation_error_batch_idx on core.validation_error(batch_id, severity);

-- ══ 4. 매핑 규칙 재사용 ════════════════════════════════════════
--
-- renew.prd 8.2 — 매핑 규칙을 저장해 다음 업로드에 재사용합니다.

create table if not exists core.column_mapping (
  data_type     text not null,
  source_column text not null,
  target_column text not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (data_type, source_column)
);

-- ══ 5. raw 쓰기 권한 ═══════════════════════════════════════════
--
-- 지금까지 raw 는 앱에서 읽지도 쓰지도 못했습니다(01-grants.sql).
-- 적재를 하려면 쓰기가 필요하므로, 관리자에게만 엽니다.
--
-- core/analytics 뷰는 postgres 소유라 RLS 를 우회합니다.
-- 따라서 아래 설정으로 기존 화면이 깨지지 않습니다 (§8 에서 확인).

do $$
declare
  t text;
  targets text[] := array[
    'usage_history', 'inventory', 'item_master', 'supplier_master',
    'purchase_order', 'goods_receipt', 'shipment_log',
    'business_event', 'sales_order', 'item_substitute'
  ];
begin
  foreach t in array targets loop
    if to_regclass('raw.' || t) is null then continue; end if;

    execute format('grant select, insert, update, delete on raw.%I to authenticated', t);
    execute format('revoke all on raw.%I from anon', t);
    execute format('alter table raw.%I enable row level security', t);

    execute format('drop policy if exists %I on raw.%I', t || '_read', t);
    execute format('create policy %I on raw.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on raw.%I', t || '_write_admin', t);
    execute format('create policy %I on raw.%I for all to authenticated
                      using (core.is_admin()) with check (core.is_admin())',
                   t || '_write_admin', t);
  end loop;
end $$;

grant usage on schema raw to authenticated;

-- ══ 6. 되돌리기 ════════════════════════════════════════════════
--
-- renew.prd 8.4 — batch_id 단위로 되돌립니다.
-- append 로 넣은 것만 되돌릴 수 있습니다.
-- replace 는 지운 원본을 복구할 수 없으므로 되돌리기 대상이 아닙니다.

create or replace function core.rollback_batch(p_batch_id text)
returns table (deleted_rows bigint, message text)
language plpgsql
security definer
set search_path = core, raw, public
as $$
declare
  b core.upload_batch%rowtype;
  n bigint;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into b from core.upload_batch where batch_id = p_batch_id;
  if not found then
    return query select 0::bigint, '해당 배치를 찾을 수 없습니다'::text;
    return;
  end if;

  if b.status <> 'IMPORTED' then
    return query select 0::bigint,
      ('적재 완료 상태가 아닙니다 (현재: ' || b.status || ')')::text;
    return;
  end if;

  if b.mode = 'replace' then
    return query select 0::bigint,
      '기간 교체로 적재한 배치는 되돌릴 수 없습니다. 지운 원본을 복구할 수 없습니다'::text;
    return;
  end if;

  execute format('delete from %s where batch_id = $1', b.target_table)
    using p_batch_id;
  get diagnostics n = row_count;

  update core.upload_batch
     set status = 'ROLLED_BACK', rolled_back_at = now(),
         message = n || '행을 되돌렸습니다'
   where batch_id = p_batch_id;

  return query select n, (n || '행을 되돌렸습니다')::text;
end;
$$;

revoke all on function core.rollback_batch(text) from public, anon;
grant execute on function core.rollback_batch(text) to authenticated;

-- ══ 7. analytics 뷰 ════════════════════════════════════════════

create or replace view analytics.v_import_history as
select
  b.batch_id, b.filename, b.data_type, b.target_table, b.source_type, b.mode, b.status,
  b.total_rows, b.success_rows, b.warning_rows, b.error_rows, b.imported_rows,
  b.uploader_email, b.uploaded_at, b.imported_at, b.rolled_back_at, b.message,
  -- append 로 적재 완료된 것만 되돌릴 수 있습니다
  (b.status = 'IMPORTED' and b.mode <> 'replace') as rollback_available
from core.upload_batch b;

create or replace view analytics.v_validation_error as
select e.id, e.batch_id, b.filename, b.data_type, e.row_number, e.column_name,
       e.severity, e.code, e.message, e.raw_row, b.uploaded_at
  from core.validation_error e
  join core.upload_batch b using (batch_id);

-- 실제 raw 컬럼 목록. 자동 매핑이 이 목록과 대조합니다.
-- 컬럼명을 코드에 적어 두지 않기 위해서입니다.
create or replace view analytics.v_raw_schema as
select table_name, column_name, data_type, is_nullable, ordinal_position
  from information_schema.columns
 where table_schema = 'raw'
 order by table_name, ordinal_position;

-- ══ 8. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['upload_batch','import_staging','validation_error','column_mapping'] loop
    execute format('grant select, insert, update, delete on core.%I to authenticated', t);
    execute format('revoke all on core.%I from anon', t);
    execute format('alter table core.%I enable row level security', t);

    execute format('drop policy if exists %I on core.%I', t || '_read', t);
    execute format('create policy %I on core.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on core.%I', t || '_write_admin', t);
    execute format('create policy %I on core.%I for all to authenticated
                      using (core.is_admin()) with check (core.is_admin())',
                   t || '_write_admin', t);
  end loop;
end $$;

grant usage, select on sequence core.validation_error_id_seq to authenticated;
grant select on analytics.v_import_history   to authenticated;
grant select on analytics.v_validation_error to authenticated;
grant select on analytics.v_raw_schema       to authenticated;

-- ══ 9. 확인 ════════════════════════════════════════════════════
--
-- raw 에 RLS 를 켠 뒤에도 기존 화면 뷰가 그대로 나와야 합니다.
-- 뷰가 postgres 소유라 RLS 를 우회하기 때문입니다.

select 'v_leadtime_gap'  as view_name, count(*) as rows from analytics.v_leadtime_gap
union all
select 'v_stockout_risk',  count(*) from analytics.v_stockout_risk
union all
select 'v_data_coverage',  count(*) from analytics.v_data_coverage;

-- raw 컬럼 목록 (자동 매핑이 쓸 정보)
select table_name, count(*) as columns
  from analytics.v_raw_schema
 group by table_name
 order by table_name;
