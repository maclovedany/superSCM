-- Task 12 · 월말 재고 성과와 동적 기준월 대시보드
--
-- 목적: Forecast 정확도(STEP 7 WAPE·Bias)와 별도로, 실제 발주 성과를 월말 재고수량·금액으로
-- 평가한다(stage1.md §10). 대시보드·사이드바·상단바의 하드코딩된 "2026.09"를 진행 중인
-- 취합 주기(core.planning_cycle, Task 7) 기준 운영 기준월로 바꾼다.
--
-- ★ 파일 번호 — 계획서 초안은 이 파일을 ...001100으로 부르지만 그 번호는 Task 11
--   (20260911001100_stage1_department_screens.sql)이 이미 썼다. 여기서는 ...001150을 쓴다.
--
-- 컨트롤러 판정(요약 — 세부는 각 절 주석)
--   1) 월말 재고수량 = 그 달 안에 존재하는 가장 최근 NORMAL 분류 스냅샷(Task 4 분류 규칙) —
--      없으면 core.stock_balance(현재값)로 대체하거나 보간하지 않고 null + MONTH_END_SNAPSHOT_MISSING.
--      품목 자체가 한 번도 분류된 적이 없으면(core.stock_balance에 행 자체가 없으면) Task 4의
--      INVENTORY_SCOPE_UNCLASSIFIED를 그대로 쓴다(새 분류 로직을 만들지 않는다).
--   2) 월말 재고금액 = analytics.v_item_policy.approved_unit_price만 쓴다 — 없으면 UNIT_PRICE_UNSET,
--      금액 null. 금액이 null인 품목은 합계에서 제외하고, KPI 뷰가 제외 건수와 사유를 함께 보고한다
--      (0으로 조용히 합산하지 않는다). 목표재고도 approved_target_stock_qty만 쓰고 없으면
--      null + TARGET_STOCK_UNSET. 차이 = 실제 − 목표.
--   3) analytics.v_current_planning_cycle은 core.planning_cycle의 활성 주기에서 운영 기준월과
--      상태를 만든다. 활성 주기가 없으면 null + PLANNING_CYCLE_NOT_OPEN. "현재"는 항상
--      (clock_timestamp() at time zone 'Asia/Seoul')::date 기준이다(세션 timezone에 좌우되지 않는다 —
--      error.md #26·Task 7 주석과 같은 이유). 동시에 여러 달이 활성 상태일 수 있으므로(스키마상 막지
--      않는다) 기준월(plan_month) 내림차순 → 연 시각(opened_at) 내림차순으로 하나를 고른다.
--   4) 대시보드 KPI는 저장된 뷰 값만 쓴다 — 화면은 집계하지 않는다. 이 마이그레이션은 재고 KPI
--      전용 뷰만 새로 만든다. 수요 제출·승인 대기·배정 부족·발주계획 상태는 Task 5·6·7·8·9b가 이미
--      만든 analytics 뷰(v_demand_submission_status·v_my_approval_inbox·v_allocation_queue·
--      v_procurement_plan)를 lib/kpi/repository.ts가 그대로 다시 읽는다 — 새 집계 뷰를 만들지 않는다
--      (그 뷰들이 이미 상태별로 계산해 둔 값이다).
--   5) 계획 쪽 기대값(analytics.v_procurement_plan_line.projected_month_end_qty ·
--      projected_inventory_value, Task 9b)과 이 마이그레이션의 실제 월말 KPI는 서로 다른 객체로
--      남긴다 — 계획 라인을 실적으로 덮어쓰지 않는다.
--   6) STEP 7 Forecast WAPE·Bias는 이 KPI와 같은 뷰·같은 카드에 합치지 않는다(화면에서만 지키는
--      규칙이 아니라 이 마이그레이션도 별도 뷰로만 만든다).
--   7) 오늘 배포 DB에는 실 재고 스냅샷도 승인된 단가도 없다(memory: 실데이터에 재고·리드타임 없음).
--      모든 행이 null + 사유 코드로 보이는 것이 정상이다 — 그렇게 보이도록 화면을 만든다.
--
-- 다시 실행해도 안전합니다. 운영 테이블에 예시 데이터를 넣지 않습니다. 실제 Supabase 적용은
-- 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. 월말 재고 스냅샷 원장 ═══════════════════════════════════════
--
-- ★ raw.inventory 자체는 배치마다 import_mode(replace·upsert)에 따라 옛 행이 지워질 수 있어
--   "그 달의 스냅샷이 무엇이었는가"를 나중에 다시 조회해 재구성할 수 없다(STEP 4
--   core.commit_import_batch의 replace 분기가 raw.inventory 전체를 delete한다). 그래서 이 표는
--   core.stock_balance(현재값 하나만 유지)와 달리 "그 달에 관측된 NORMAL 수량"을 커밋 시점에
--   append 방식으로 영구 보존한다. (기준월, 품목)당 한 행만 있고, 그 달 안에서 가장 최근
--   snapshot_at만 남긴다(같은 달에 재적재되면 더 최근 시각만 승리 — 컨트롤러 판정 1).
-- ★ NORMAL로 분류되지 않으면(분류 불가 포함) 이 표에 행을 만들지 않는다 — 0이 아니라 "이 달은
--   모른다"를 뜻하기 때문이다(AGENTS.md 5번). "품목 자체가 한 번도 분류된 적 없음"과 "이 품목은
--   분류되지만 이 달만 스냅샷이 없음"은 analytics.v_inventory_performance가
--   core.stock_balance 존재 여부로 구분한다(아래 4절).

create table if not exists core.month_end_inventory_snapshot (
  plan_month      date not null check (plan_month = date_trunc('month', plan_month)::date),
  item_id         text not null,
  normal_qty      numeric not null check (normal_qty >= 0),
  snapshot_at     timestamptz not null,
  source_batch_id uuid references core.upload_batch(batch_id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (plan_month, item_id)
);

comment on table core.month_end_inventory_snapshot is
  'Task 12 — (기준월, 품목)당 그 달 안에서 가장 최근인 NORMAL 분류 재고 스냅샷. raw.inventory가 '
  '재적재로 지워져도 이 표는 append 방식으로 남는다. NORMAL 스냅샷이 한 번도 없던 달·품목은 행 '
  '자체가 없다(0이 아니라 모른다는 뜻) — analytics.v_inventory_performance가 '
  'MONTH_END_SNAPSHOT_MISSING으로 보여준다';
comment on column core.month_end_inventory_snapshot.normal_qty is
  '그 달 안에서 가장 최근 NORMAL 스냅샷 시각의 수량 합(core.classify_inventory_scope 기준, Task 4)';
comment on column core.month_end_inventory_snapshot.snapshot_at is
  '위 normal_qty를 관측한 실제 시각(그 달 안에서 가장 최근). 화면에 그대로 표시한다';


-- ══ 2. 배치 커밋 시 월말 스냅샷 반영 ══════════════════════════════
--
-- core.apply_stock_balance_from_batch(Task 4)와 같은 raw.inventory 분류 규칙을 그대로 재사용하되,
-- item_id별이 아니라 (item_id, 그 스냅샷이 속한 달)별로 묶는다. 권한 검사가 없는 내부 계산이며
-- core.commit_import_batch(이미 관리자 전용)와 core.refresh_stock_balance(이미 STOCK_VIEW_ALL·
-- 관리자 전용)만 부른다.

create or replace function core.apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_count integer;
begin
  with classified as (
    -- Task 4 core.apply_stock_balance_from_batch와 같은 필터 · 같은 분류 함수.
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      nullif(i."현재고", '')::numeric as qty,
      i.snapshot_at,
      core.classify_inventory_scope(i.warehouse_code, i.inventory_status) as scope_code
    from raw.inventory i
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  normal_only as (
    select item_id, qty, snapshot_at from classified where scope_code = 'NORMAL'
  ),
  aggregated as (
    -- 같은 배치·같은 품목 안에서도 스냅샷 시각이 다른 여러 달에 걸칠 수 있으므로 달별로 묶는다.
    -- ★ Task 7 core.raise_demand_submission_reminders·submission_deadline과 같은 이유로 세션
    --   timezone에 좌우되지 않도록 명시적으로 'Asia/Seoul' 벽시계 기준으로 달을 정한다 — 그냥
    --   date_trunc('month', snapshot_at)를 쓰면 세션 timezone에 따라 월 경계 근처 스냅샷(예:
    --   2026-09-01T03:00:00Z)이 UTC-8 세션에서는 8월로 잘못 묶일 수 있다(error.md 타임존 계열
    --   이슈와 같은 클래스). timestamptz를 timestamp로 바꾼 뒤 truncate하면 이후 truncate·cast는
    --   세션 timezone의 영향을 받지 않는다.
    select
      item_id,
      date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date as plan_month,
      sum(qty) as normal_qty,
      max(snapshot_at) as snapshot_at
    from normal_only
    group by item_id, date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date
  ),
  upserted as (
    insert into core.month_end_inventory_snapshot (plan_month, item_id, normal_qty, snapshot_at, source_batch_id, updated_at)
    select plan_month, item_id, normal_qty, snapshot_at, p_batch_id, now()
      from aggregated
    on conflict (plan_month, item_id) do update
       set normal_qty      = excluded.normal_qty,
           snapshot_at     = excluded.snapshot_at,
           source_batch_id = excluded.source_batch_id,
           updated_at      = now()
     -- 컨트롤러 판정 1 — 그 달 안에서 가장 최근 스냅샷만 남긴다. 옛 배치를 나중에(재검증 등으로)
     -- 다시 반영해도 이미 있는 더 최근 값을 덮어쓰지 않는다.
     where excluded.snapshot_at >= core.month_end_inventory_snapshot.snapshot_at
    returning item_id
  )
  select count(*) into v_count from upserted;
  return coalesce(v_count, 0);
end;
$$;

comment on function core.apply_month_end_inventory_snapshot_from_batch(uuid) is
  'Task 12 — inventory 배치의 NORMAL 분류 행을 (item_id, 스냅샷 달)별로 묶어 '
  'core.month_end_inventory_snapshot에 append-upsert한다. 그 달의 기존 값보다 이르면 덮어쓰지 않는다.
   권한 검사 없음 — commit_import_batch · refresh_stock_balance만 부른다';


-- ══ 2-1. 정상 임포트 · 수동 재반영 경로에 연결 ═══════════════════════
--
-- Task 4(20260911000500)가 재정의한 두 함수를 다시 재정의한다. 기존 로직은 그대로 두고 inventory
-- 배치 반영 뒤 월말 스냅샷 반영만 추가한다(error.md #16과 같은 이유로 새 함수를 따로 만들지 않고
-- 같은 지점에 이어 붙인다 — 두 곳 모두 이미 "inventory 배치 커밋 직후"라는 같은 트랜잭션 지점이다).

create or replace function core.commit_import_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path = core, raw, pg_temp as $$
declare b core.upload_batch%rowtype; table_name text; r record; payload jsonb;
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  select * into b from core.upload_batch where batch_id=p_batch_id for update;
  if not found or b.status <> 'VALIDATED' or b.error_rows > 0 then raise exception '검증 완료 및 오류 0건인 batch만 적재할 수 있습니다.' using errcode='22023'; end if;
  table_name := core.import_target_table(b.import_type); if table_name is null then raise exception '지원하지 않는 Import Type입니다.'; end if;
  if b.import_mode='replace' then execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''REPLACE'' from raw.%I t',table_name) using p_batch_id,table_name; execute format('delete from raw.%I',table_name); end if;
  for r in select row_number,mapped_data from core.import_staging where batch_id=p_batch_id and validation_status in ('SUCCESS','WARNING') order by row_number loop
    payload := r.mapped_data || jsonb_build_object('batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',coalesce(r.mapped_data->>'source_record_id',r.row_number::text));
    if b.import_type='inventory' then payload := jsonb_build_object('품목코드',payload->>'item_id','창고',payload->>'warehouse','현재고',payload->>'current_stock','기준일자',payload->>'reference_date','안전재고',payload->>'safety_stock','inventory_status',payload->>'inventory_status','warehouse_code',payload->>'warehouse_code','snapshot_at',payload->>'snapshot_at','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='item_master' then payload := jsonb_build_object('품목코드',payload->>'item_id','품목명',payload->>'item_name','품목구분',payload->>'item_type','단위',payload->>'unit','supplier_id',payload->>'supplier_id','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='supplier_master' then payload := jsonb_build_object('공급업체코드',payload->>'supplier_id','공급업체명',payload->>'supplier_name','국가',payload->>'country','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='purchase_order' then payload := jsonb_build_object('발주번호',payload->>'source_record_id','발주일',payload->>'order_date','공급업체',payload->>'supplier_id','품목코드',payload->>'item_id','발주수량',payload->>'qty','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='goods_receipt' then payload := jsonb_build_object('입고번호',payload->>'source_record_id','품목코드',payload->>'item_id','입고수량',payload->>'qty','입고일',payload->>'receipt_date','receipt_status',payload->>'receipt_status','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id'); end if;
    if b.import_mode='upsert' then execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''UPSERT'' from raw.%I t where t.source_type=''FILE_UPLOAD'' and t.source_record_id=$3',table_name) using p_batch_id,table_name,payload->>'source_record_id'; execute format('delete from raw.%I where source_type=''FILE_UPLOAD'' and source_record_id=$1',table_name) using payload->>'source_record_id'; end if;
    execute format('insert into raw.%I select * from jsonb_populate_record(null::raw.%I,$1)',table_name,table_name) using payload;
  end loop;
  update core.upload_batch set status='IMPORTED', imported_at=now(), forecast_stale_marked=b.import_type in ('usage_history','sales_order','business_event') where batch_id=p_batch_id;
  if b.import_type in ('usage_history','sales_order','business_event') and to_regclass('core.forecast_run') is not null then execute 'update core.forecast_run set stale_at=now() where data_snapshot_at < now() and stale_at is null'; end if;
  if b.import_type = 'inventory' then perform core.apply_stock_balance_from_batch(p_batch_id); perform core.apply_month_end_inventory_snapshot_from_batch(p_batch_id);
  elsif b.import_type = 'goods_receipt' then perform core.apply_stock_receipts_from_batch(p_batch_id); end if;
end; $$;

comment on function core.commit_import_batch(uuid) is
  'STEP 4 원본 + Task 4 확장 + Task 12 확장: inventory 배치 적재 직후 같은 트랜잭션에서 '
  'core.apply_stock_balance_from_batch(현재값)와 core.apply_month_end_inventory_snapshot_from_batch '
  '(그 달 스냅샷 append)를 함께 호출한다. goods_receipt는 이전과 동일(월말 스냅샷에 영향 없음 — '
  '입고는 실사 스냅샷이 아니다)';

grant execute on function core.commit_import_batch(uuid) to authenticated;
revoke execute on function core.commit_import_batch(uuid) from anon, public;

create or replace function core.refresh_stock_balance(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch core.upload_batch%rowtype;
  v_stock_count integer;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 재고 배치를 반영할 수 있습니다.' using errcode = '42501';
  end if;

  if not (core.has_permission('STOCK_VIEW_ALL', v_actor) or core.is_admin(v_actor)) then
    raise exception '정상 창고재고 반영 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into v_batch from core.upload_batch where batch_id = p_batch_id;
  if not found then
    raise exception '재고 배치를 찾을 수 없습니다: %', p_batch_id using errcode = 'P0002';
  end if;
  if v_batch.import_type <> 'inventory' then
    raise exception 'inventory 배치만 정상 창고재고에 반영할 수 있습니다.' using errcode = '22023';
  end if;
  if v_batch.status not in ('VALIDATED', 'IMPORTED') then
    raise exception '검증 완료된 배치만 반영할 수 있습니다. 현재 상태: %', v_batch.status using errcode = '22023';
  end if;

  v_stock_count := core.apply_stock_balance_from_batch(p_batch_id);
  -- Task 12 — 같은 배치를 수동으로 다시 반영할 때도 월말 스냅샷을 함께 갱신한다(분류 규칙을
  -- 나중에 고친 뒤 재반영하는 경우 등). 반환값은 이전과 같은 계약(정상 창고재고 갱신 건수)을
  -- 유지한다 — 이 값을 읽는 화면이 아직 없지만 계약을 바꾸지 않는다.
  perform core.apply_month_end_inventory_snapshot_from_batch(p_batch_id);
  return v_stock_count;
end;
$$;

comment on function core.refresh_stock_balance(uuid) is
  'SCM 담당자가 수동으로 다시 반영할 때 쓴다. 정상 경로는 core.commit_import_batch가 커밋 직후 '
  '자동으로 반영을 호출하므로 보통 다시 호출할 필요가 없다(분류 규칙을 나중에 고쳤을 때 재반영하는 '
  '용도). Task 12 — 정상 창고재고(core.stock_balance)와 월말 스냅샷(core.month_end_inventory_snapshot)을 '
  '함께 다시 계산한다';


-- ══ 3. 운영 기준월 — analytics.v_current_planning_cycle ═══════════
--
-- ★ 여러 달이 동시에 활성 상태일 수 있으므로(core.planning_cycle의 유니크 제약은 "달당 활성
--   1개"이지 "전체에서 활성 1개"가 아니다) plan_month 내림차순 → opened_at 내림차순으로 하나를
--   고른다. 활성 주기가 없으면 한 행을 null + PLANNING_CYCLE_NOT_OPEN으로 돌려준다(행 자체가
--   없으면 화면이 "조회 실패"와 "취합 주기 없음"을 구분하지 못한다 — AGENTS.md 3번).

create or replace view analytics.v_current_planning_cycle
with (security_invoker = true)
as
select
  c.cycle_id,
  c.plan_month,
  c.status,
  c.submission_deadline,
  c.is_active,
  c.opened_at,
  case when c.cycle_id is null then 'PLANNING_CYCLE_NOT_OPEN' end as reason_code
from (values (1)) as base(x)
left join (
  select * from core.planning_cycle
   where is_active
   order by plan_month desc, opened_at desc
   limit 1
) c on true;

comment on view analytics.v_current_planning_cycle is
  'Task 12 — 운영 기준월과 취합 주기 상태를 한 행으로 돌려준다. 활성 주기가 없으면 '
  'null + PLANNING_CYCLE_NOT_OPEN(행은 항상 1개). 대시보드 · 사이드바 · 상단바가 이 값으로 '
  '하드코딩된 기준월을 대체한다(procurement-app.tsx 레거시 프로토타입은 대상이 아니다)';

grant select on analytics.v_current_planning_cycle to authenticated;
revoke all on analytics.v_current_planning_cycle from anon;


-- ══ 4. 월말 재고 성과 — analytics.v_inventory_performance ═════════
--
-- 그리드 = (core.planning_cycle이 열렸던 모든 달 ∪ 스냅샷이 존재하는 모든 달) × 전체 품목
-- (core.v_item_master). 취합 주기가 아직 없던 과거 달이라도 스냅샷이 있으면 포함하고, 반대로
-- 취합 주기는 열렸지만 스냅샷이 없는 달도 포함해 MONTH_END_SNAPSHOT_MISSING을 보여준다.
--
-- 사유 코드 우선순위 — qty_reason_code · value_reason_code · diff_reason_code 세 열은 같은 순서로
-- 계단식(cascade)이다(그 값의 계산이 실제로 수량에 기대기 때문) —
--   1) 그 품목이 core.stock_balance에 행 자체가 없다(한 번도 NORMAL로 분류된 적이 없다)
--      → INVENTORY_SCOPE_UNCLASSIFIED (Task 4의 신호를 그대로 재사용 — 새 분류를 만들지 않는다)
--   2) 그 달에 NORMAL 스냅샷이 없다(품목 자체는 분류 가능) → MONTH_END_SNAPSHOT_MISSING
--   3) value_reason_code만 — 승인된 단가가 없다 → UNIT_PRICE_UNSET
--      diff_reason_code만 — 승인된 목표재고가 없다 → TARGET_STOCK_UNSET
-- target_stock_reason_code(품목 열 자체의 사유)는 계단식이 아니다 — 목표재고는 그 달 수량과 무관하게
-- analytics.v_item_policy의 승인 여부만으로 정해지는 품목 단위 사실이기 때문에, 그 달에 수량이 없는
-- 품목이라도 목표재고 자체는(승인만 됐다면) 그대로 보여준다. UNIT_PRICE_UNSET · TARGET_STOCK_UNSET은
-- analytics.v_item_policy가 이미 계산해 둔 사유 코드를 그대로 쓴다(Task 9a·9b).

create or replace view analytics.v_inventory_performance
with (security_invoker = true)
as
with months as (
  select plan_month from core.planning_cycle
  union
  select plan_month from core.month_end_inventory_snapshot
),
items as (
  select item_id, item_name from core.v_item_master
)
select
  m.plan_month,
  i.item_id,
  i.item_name,
  mes.normal_qty as actual_qty,
  mes.snapshot_at,
  case
    when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED'
    when mes.normal_qty is null then 'MONTH_END_SNAPSHOT_MISSING'
  end as qty_reason_code,
  ip.approved_unit_price as unit_price,
  case
    when mes.normal_qty is not null and ip.approved_unit_price is not null
    then mes.normal_qty * ip.approved_unit_price
  end as actual_value,
  case
    when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED'
    when mes.normal_qty is null then 'MONTH_END_SNAPSHOT_MISSING'
    when ip.approved_unit_price is null then 'UNIT_PRICE_UNSET'
  end as value_reason_code,
  ip.approved_target_stock_qty as target_stock_qty,
  case
    when ip.approved_target_stock_qty is null then 'TARGET_STOCK_UNSET'
  end as target_stock_reason_code,
  case
    when mes.normal_qty is not null and ip.approved_target_stock_qty is not null
    then mes.normal_qty - ip.approved_target_stock_qty
  end as diff_qty,
  case
    when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED'
    when mes.normal_qty is null then 'MONTH_END_SNAPSHOT_MISSING'
    when ip.approved_target_stock_qty is null then 'TARGET_STOCK_UNSET'
  end as diff_reason_code
from months m
cross join items i
left join core.month_end_inventory_snapshot mes on mes.plan_month = m.plan_month and mes.item_id = i.item_id
left join core.stock_balance sb on sb.item_id = i.item_id
left join analytics.v_item_policy ip on ip.item_id = i.item_id
where core.has_permission('STOCK_VIEW_ALL');

comment on view analytics.v_inventory_performance is
  'Task 12 — 품목 × 달별 월말 재고 실적. 실제 수량은 그 달 안 가장 최근 NORMAL 스냅샷만 쓰고 '
  '없으면 null + MONTH_END_SNAPSHOT_MISSING(품목 자체가 분류된 적 없으면 INVENTORY_SCOPE_UNCLASSIFIED). '
  '금액 · 목표재고는 analytics.v_item_policy의 승인값만 쓴다(UNIT_PRICE_UNSET · TARGET_STOCK_UNSET). '
  'STOCK_VIEW_ALL(SCM팀)만 조회한다 — 배정 · 조회 화면과 달리 원가 정보라 부서별 조회 범위를 두지 않는다';

grant select on analytics.v_inventory_performance to authenticated;
revoke all on analytics.v_inventory_performance from anon;


-- ══ 5. 월말 재고 성과 요약 — analytics.v_inventory_performance_kpi ══
--
-- 컨트롤러 판정 2 — 금액 · 목표재고가 null인 품목은 합계에서 빠지고(0으로 세지 않는다), 몇 건이
-- 왜 빠졌는지 이 뷰가 함께 보고한다. STOCK_VIEW_ALL 권한이 없으면 기저 뷰가 이미 0행이므로 이
-- 뷰도 그 달에 대해 0행이다(별도 WHERE가 필요 없다 — v_available_stock과 같은 방식).

create or replace view analytics.v_inventory_performance_kpi
with (security_invoker = true)
as
select
  p.plan_month,
  count(*) as n_items,
  count(*) filter (where p.actual_qty is not null) as n_qty_available,
  count(*) filter (where p.qty_reason_code = 'MONTH_END_SNAPSHOT_MISSING') as n_month_end_snapshot_missing,
  count(*) filter (where p.qty_reason_code = 'INVENTORY_SCOPE_UNCLASSIFIED') as n_inventory_scope_unclassified,
  sum(p.actual_qty) filter (where p.actual_qty is not null) as total_actual_qty,
  count(*) filter (where p.actual_value is not null) as n_value_available,
  count(*) filter (where p.value_reason_code = 'UNIT_PRICE_UNSET') as n_unit_price_unset,
  sum(p.actual_value) filter (where p.actual_value is not null) as total_actual_value,
  count(*) filter (where p.target_stock_qty is not null) as n_target_available,
  count(*) filter (where p.target_stock_reason_code = 'TARGET_STOCK_UNSET') as n_target_stock_unset,
  sum(p.target_stock_qty) filter (where p.target_stock_qty is not null) as total_target_stock_qty,
  sum(p.diff_qty) filter (where p.diff_qty is not null) as total_diff_qty,
  count(*) filter (where p.diff_qty is not null) as n_diff_available
from analytics.v_inventory_performance p
group by p.plan_month;

comment on view analytics.v_inventory_performance_kpi is
  'Task 12 — 달별 월말 재고 총수량 · 총금액 · 목표재고 대비 차이 요약. 합계는 값이 있는 품목만 '
  '더하고(n_* 열이 제외 건수와 사유를 함께 보고한다), 계산 불가 품목을 0으로 조용히 포함하지 않는다. '
  'Forecast WAPE·Bias(STEP 7)는 이 뷰에 합치지 않는다 — 별도 분석 화면에서만 조회한다';

grant select on analytics.v_inventory_performance_kpi to authenticated;
revoke all on analytics.v_inventory_performance_kpi from anon;


-- ══ 6. 월말 스냅샷 표 RLS ══════════════════════════════════════════
--
-- ★ 원가와 직결되는 재고 실적 원장이라 core.stock_balance(여러 부서가 함께 보는 운영 가용재고)
--   보다 좁게, STOCK_VIEW_ALL(SCM팀)만 읽는다(컨트롤러 판정: "SCM 역할·관리자만 KPI 뷰를 읽는다" —
--   이 프로젝트의 기존 analytics 뷰는 관리자 자동 우회를 두지 않으므로(AGENTS.md — 관리자는 업무
--   권한을 자동으로 받지 않는다, v_available_stock과 동일 관례) is_admin()을 추가하지 않는다).
--   쓰기는 위 SECURITY DEFINER 함수를 통해서만 한다.

alter table core.month_end_inventory_snapshot enable row level security;

drop policy if exists month_end_inventory_snapshot_read on core.month_end_inventory_snapshot;
create policy month_end_inventory_snapshot_read on core.month_end_inventory_snapshot
  for select to authenticated
  using (core.has_permission('STOCK_VIEW_ALL'));

revoke insert, update, delete on core.month_end_inventory_snapshot from authenticated;
grant select on core.month_end_inventory_snapshot to authenticated;
revoke all on core.month_end_inventory_snapshot from anon, public;

revoke all on function core.apply_month_end_inventory_snapshot_from_batch(uuid) from public, anon, authenticated;


-- ══ 확인 쿼리(운영 DB에서 수동 확인용, 실행하지 않음) ═══════════════
--
-- select * from analytics.v_current_planning_cycle;
--   -- 활성 취합 주기가 없으면 정확히 1행, plan_month null, reason_code = 'PLANNING_CYCLE_NOT_OPEN'.
--
-- select plan_month, item_id, actual_qty, qty_reason_code, unit_price, actual_value, value_reason_code,
--        target_stock_qty, target_stock_reason_code, diff_qty, diff_reason_code
--   from analytics.v_inventory_performance
--  order by plan_month desc, item_id;
--   -- 오늘 배포 DB는 core.planning_cycle을 아직 한 번도 열지 않았고 실 재고 스냅샷도 없다. 이 그리드는
--   -- (열린 적 있는 달 ∪ 스냅샷이 있는 달) × 품목이므로, 아직 아무 달도 없으면 이 뷰는 정확히 0행이다
--   -- (화면은 이보다 먼저 v_current_planning_cycle을 확인해 PLANNING_CYCLE_NOT_OPEN을 보여주므로
--   -- "빈 그리드"와 "취합 주기 없음"을 혼동하지 않는다). Task 7로 이번 달 취합 주기를 연 뒤에는 모든
--   -- 행이 null + MONTH_END_SNAPSHOT_MISSING 또는 INVENTORY_SCOPE_UNCLASSIFIED여야 한다(컨트롤러 판정 7).
--
-- select * from analytics.v_inventory_performance_kpi order by plan_month desc;
--   -- 취합 주기를 연 뒤: n_items = n_month_end_snapshot_missing + n_inventory_scope_unclassified,
--   -- total_actual_qty · total_actual_value는 null이어야 한다(값 있는 품목이 하나도 없으므로).
--
-- STOCK_VIEW_ALL이 없는 사용자(set_config('request.jwt.claim.sub', <해당 사용자 uuid>, false) 뒤):
-- select count(*) from analytics.v_inventory_performance;               -- 0
-- select count(*) from analytics.v_inventory_performance_kpi;           -- 0
