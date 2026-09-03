-- ──────────────────────────────────────────────────────────────
-- STEP 4 (보완) · 적재를 SQL 함수로 옮깁니다
--
-- 왜 필요한가
--   raw 스키마는 REST API 에 노출하지 않습니다(SCHEMA.md · sql/01-grants.sql).
--   그래서 앱이 supabase.schema('raw').insert() 로 넣을 수 없습니다.
--   raw 를 노출하면 적재는 되지만, 화면이 raw 를 직접 읽을 길도 함께 열립니다.
--
--   대신 core 에 security definer 함수를 두고 앱은 이 함수만 부릅니다.
--   raw 는 계속 닫아 둡니다.
--
-- 덤으로 얻는 것
--   · 적재가 한 트랜잭션에서 끝납니다 (부분 적재가 남지 않습니다)
--   · 수만 행을 500개씩 왕복하지 않습니다
--   · 컬럼 기본값(loaded_at 등)이 살아납니다
--
-- sql/08-import.sql 을 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

create or replace function core.import_commit(p_batch_id text)
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
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

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

revoke all on function core.import_commit(text) from public, anon;
grant execute on function core.import_commit(text) to authenticated;

-- ══ 확인 ═══════════════════════════════════════════════════════

select proname, prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core' and proname in ('import_commit', 'rollback_batch');
