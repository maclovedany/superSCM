-- 실습 데이터 5 · 재고 스냅샷
--
-- ★ 적재는 STEP 4 경로를 그대로 씁니다. inventory 배치를 커밋하면 같은 트랜잭션에서
--   core.apply_stock_balance_from_batch(현재 정상 창고재고)와
--   core.apply_month_end_inventory_snapshot_from_batch(그 달 월말 스냅샷)가 함께 돕니다.
--   그래서 재고 화면과 월말 재고 성과 화면이 한 번에 채워집니다.
--
-- ★ 스냅샷 시각은 **기준월(M13)** 안으로 잡습니다. 그래야
--   (1) analytics.v_available_stock의 정상 창고재고가 발주계획 1개월차 시작재고가 되고,
--   (2) analytics.v_inventory_performance가 그 기준월의 월말 실적을 보여줍니다.
--   기준월은 04-usage-history.sql이 정한 검증 기간에서 계산합니다(하드코딩하지 않습니다).
--
-- ★ 일부러 분류되지 않는 행을 넣습니다 — 사유 코드 경로가 화면에서 계속 보여야 하기 때문입니다.
--     seq 11 품목: 등록되지 않은 재고상태('기타보관') → core.classify_inventory_scope가 null
--                  → core.stock_balance에 올라가지 않음 → 화면에 INVENTORY_SCOPE_UNCLASSIFIED
--     seq 1 품목:  '검사대기' 행을 함께 넣어 정상 창고재고에서 제외되는 것을 보여줍니다.
--   둘 다 0으로 채우지 않고 "모른다/제외한다"로 남는 것이 이 프로젝트의 규칙입니다(AGENTS.md 5번).

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_batch uuid := gen_random_uuid();
  v_plan_month date;
  v_snapshot timestamptz;
  v_rows integer;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  select (date_trunc('month', test_end) + interval '1 month')::date into v_plan_month
    from core.forecast_setting where active;
  if v_plan_month is null then
    raise exception '활성 학습/검증 기간이 없습니다. 04-usage-history.sql을 먼저 실행하세요.';
  end if;
  -- 기준월 15일 09:00(한국시간). 월 경계 timezone 문제를 피하려고 월 중간으로 잡습니다.
  v_snapshot := (v_plan_month + interval '14 days' + interval '9 hours') at time zone 'Asia/Seoul';

  if exists (select 1 from core.stock_balance sb
              join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = sb.item_id) then
    raise notice '실습 재고가 이미 반영되어 있습니다 — 건너뜁니다';
    return;
  end if;

  create temporary table practice_stock on commit drop as
  -- 정상 재고 — seq 1~10
  select o.object_key as item_id,
         split_part(o.note, ':', 2)::int as seq,
         '정상'::text as inventory_status,
         'MAIN'::text as warehouse_code,
         -- 품목마다 다른 수준: 일부는 넉넉하고 일부는 부족해서 발주량 차이가 눈에 보입니다.
         (200 + 130 * split_part(o.note, ':', 2)::int)::numeric as qty
    from core.practice_object o
   where o.object_kind = 'ITEM' and split_part(o.note, ':', 2)::int <= 10
  union all
  -- 검사 대기 — seq 1. 정상 창고재고에서 제외되는 것을 보여줍니다.
  select o.object_key, split_part(o.note, ':', 2)::int, '검사대기', 'MAIN', 80::numeric
    from core.practice_object o
   where o.object_kind = 'ITEM' and split_part(o.note, ':', 2)::int = 1
  union all
  -- ★ 분류 불가 — seq 11. 등록되지 않은 상태 텍스트라 어느 범위에도 매핑되지 않습니다.
  select o.object_key, split_part(o.note, ':', 2)::int, '기타보관', 'MAIN', 450::numeric
    from core.practice_object o
   where o.object_kind = 'ITEM' and split_part(o.note, ':', 2)::int = 11;

  select count(*) into v_rows from practice_stock;

  insert into core.upload_batch (batch_id, file_name, import_type, import_mode, total_rows, success_rows,
                                 warning_rows, error_rows, status, uploaded_by, uploaded_at)
  values (v_batch, '[실습용 ' || v_label || '] practice-inventory.csv', 'inventory', 'append',
          v_rows, v_rows, 0, 0, 'VALIDATED', v_admin, now());

  insert into core.import_staging (batch_id, row_number, original_data, mapped_data, validation_status)
  select v_batch, row_number() over (order by s.seq, s.inventory_status)::integer + 1,
         jsonb_build_object('item_id', s.item_id, 'current_stock', s.qty, 'inventory_status', s.inventory_status),
         jsonb_build_object(
           'item_id',          s.item_id,
           'current_stock',    s.qty,
           'warehouse',        'MAIN',
           'warehouse_code',   s.warehouse_code,
           'inventory_status', s.inventory_status,
           'snapshot_at',      v_snapshot,
           'reference_date',   v_plan_month + 14,
           'safety_stock',     null,
           'source_record_id', 'PRACTICE-INV-' || s.item_id || '-' || s.inventory_status
         ),
         'SUCCESS'
    from practice_stock s;

  perform core.commit_import_batch(v_batch);
  perform core.register_practice_object(v_label, 'UPLOAD_BATCH', v_batch::text, '재고 스냅샷 적재');

  raise notice '재고 %행 적재 완료 — 기준월 % · 스냅샷 %', v_rows, to_char(v_plan_month, 'YYYY-MM'), v_snapshot;
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────

select sb.item_id, sb.snapshot_qty, sb.normal_qty, sb.snapshot_at
  from core.stock_balance sb
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = sb.item_id
 order by split_part(o.note, ':', 2)::int;
-- 기대: 10행(seq 1~10). seq 11은 분류 불가라 이 표에 **올라오지 않습니다.**
--       seq 1은 검사대기 80을 뺀 정상분만 있어야 합니다(330, 80 아님).

select plan_month, count(*) as items, sum(normal_qty) as total_qty
  from core.month_end_inventory_snapshot
 group by plan_month order by plan_month desc;
-- 기대: 기준월 1행 · 10품목

-- seq 11 품목이 재고 화면에서 사유 코드로 보이는지 (SCM 계정으로 조회해야 행이 나옵니다)
select o.object_key as item_id, o.note
  from core.practice_object o
 where o.object_kind = 'ITEM' and split_part(o.note, ':', 2)::int = 11;
-- 이 품목은 analytics.v_available_stock에서 normal_warehouse_qty null +
-- reason_code = 'INVENTORY_SCOPE_UNCLASSIFIED' 로 보여야 합니다(0이 아닙니다).
